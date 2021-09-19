/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as is from './is';

import { Message,
	RequestMessage, RequestType, isRequestMessage,
	ResponseMessage, isReponseMessage, ResponseError, ErrorCodes,
	NotificationMessage,  NotificationType, isNotificationMessage
} from './messages';

import { MessageReader, DataCallback, StreamMessageReader, IPCMessageReader } from './messageReader';
import { MessageWriter, StreamMessageWriter, IPCMessageWriter } from './messageWriter';
import { Disposable, Event, Emitter } from './events';
import { CancellationTokenSource, CancellationToken } from './cancellation';

export {
	Message, ErrorCodes, ResponseError,
	RequestMessage, RequestType,
	NotificationMessage, NotificationType,
	MessageReader, DataCallback, StreamMessageReader, IPCMessageReader,
	MessageWriter, StreamMessageWriter, IPCMessageWriter,
	CancellationTokenSource, CancellationToken,
	Disposable, Event, Emitter
}

interface CancelParams {
	/**
	 * The request id to cancel.
	 */
	id: number | string;
}

namespace CancelNotification {
	export const type: NotificationType<CancelParams> = { get method() { return '$/cancelRequest'; } };
}

export interface RequestHandler<P, R, E> {
	(params: P, token: CancellationToken): R | ResponseError<E> | Thenable<R | ResponseError<E>>;
}

export interface NotificationHandler<P> {
	(params: P): void;
}

export interface Logger {
	error(message: string): void;
	warn(message: string): void;
	info(message: string): void;
	log(message: string): void;
}

export enum Trace {
	Off, Messages, Verbose
}

export namespace Trace {
	export function fromString(value: string): Trace {
		value = value.toLowerCase();
		switch (value) {
			case 'off':
				return Trace.Off;
			case 'messages':
				return Trace.Messages;
			case 'verbose':
				return Trace.Verbose;
			default:
				return Trace.Off;
		}
	}
}

export interface Tracer {
	log(message: string): void;
}

export interface MessageConnection {
	sendRequest<P, R, E>(type: RequestType<P, R, E>, params: P, token?: CancellationToken) : Thenable<R>;
	onRequest<P, R, E>(type: RequestType<P, R, E>, handler: RequestHandler<P, R, E>): void;
	sendNotification<P>(type: NotificationType<P>, params?: P): void;
	onNotification<P>(type: NotificationType<P>, handler: NotificationHandler<P>): void;
	trace(value: Trace, tracer: Tracer): void;
	onError: Event<[Error, Message, number]>;
	onClose: Event<void>;
	listen();
	dispose(): void;
}

export interface ServerMessageConnection extends MessageConnection {
}

export interface ClientMessageConnection extends MessageConnection {
}

interface ResponsePromise {
	method: string;
	timerStart: number;
	resolve: (response) => void;
	reject: (error: any) => void
}

enum ConnectionState {
	Active = 1,
	Closed = 2
}

function createMessageConnection<T extends MessageConnection>(messageReader: MessageReader, messageWriter: MessageWriter, logger: Logger, client: boolean = false): T {
	let sequenceNumber = 0;
	const version: string = '2.0';

	let requestHandlers : { [name: string]: RequestHandler<any, any, any> } = Object.create(null);
	let eventHandlers : { [name: string]: NotificationHandler<any> } = Object.create(null);

	let responsePromises : { [name: string]: ResponsePromise } = Object.create(null);
	let requestTokens: { [id: string] : CancellationTokenSource } = Object.create(null);

	let trace: Trace = Trace.Off;
	let tracer: Tracer;

	let state: ConnectionState = ConnectionState.Active;
	let errorEmitter: Emitter<[Error, Message, number]> = new Emitter<[Error, Message, number]>();
	let closeEmitter: Emitter<void> = new Emitter<void>();

	function closeHandler(): void {
		if (state !== ConnectionState.Closed) {
			state = ConnectionState.Closed;
			closeEmitter.fire(undefined);
		}
	};

	function readErrorHandler(error: Error): void {
		errorEmitter.fire([error, undefined, undefined]);
	}

	function writeErrorHandler(data: [Error, Message, number]): void {
		errorEmitter.fire(data);
	}

	messageReader.onClose(closeHandler);
	messageReader.onError(readErrorHandler);

	messageWriter.onClose(closeHandler);
	messageWriter.onError(writeErrorHandler);

	function handleRequest(requestMessage: RequestMessage) {
		function reply(resultOrError: any | ResponseError<any>): void {
			let message: ResponseMessage = {
				jsonrpc: version,
				id: requestMessage.id
			};
			if (resultOrError instanceof ResponseError) {
				message.error = (<ResponseError<any>>resultOrError).toJson();
			} else {
				message.result = is.undefined(resultOrError) ? null : resultOrError;
			}
			messageWriter.write(message);
		}
		function replyError(error: ResponseError<any>) {
			let message: ResponseMessage = {
				jsonrpc: version,
				id: requestMessage.id,
				error: error.toJson()
			};
			messageWriter.write(message);
		}
		function replySuccess(result: any) {
			// The JSON RPC defines that a response must either have a result or an error
			// So we can't treat undefined as a valid response result.
			if (is.undefined(result)) {
				result = null;
			}
			let message: ResponseMessage = {
				jsonrpc: version,
				id: requestMessage.id,
				result: result
			};
			messageWriter.write(message);
		}

		let requestHandler = requestHandlers[requestMessage.method];
		if (requestHandler) {
			let cancellationSource = new CancellationTokenSource();
			let tokenKey = String(requestMessage.id);
			requestTokens[tokenKey] = cancellationSource;
			try {
				let handlerResult = requestHandler(requestMessage.params, cancellationSource.token);
				let promise = <Thenable<any | ResponseError<any>>>handlerResult;
				if (!handlerResult) {
					delete requestTokens[tokenKey];
					replySuccess(handlerResult);
				} else if (promise.then) {
					promise.then((resultOrError): any | ResponseError<any>  => {
						delete requestTokens[tokenKey];
						reply(resultOrError);
					}, error => {
						delete requestTokens[tokenKey];
						if (error instanceof ResponseError) {
							replyError(<ResponseError<any>>error);
						} else if (error && is.string(error.message)) {
							replyError(new ResponseError<void>(ErrorCodes.InternalError, `Request ${requestMessage.method} failed with message: ${error.message}`));
						} else {
							replyError(new ResponseError<void>(ErrorCodes.InternalError, `Request ${requestMessage.method} failed unexpectedly without providing any details.`));
						}
					});
				} else {
					delete requestTokens[tokenKey];
					reply(handlerResult);
				}
			} catch (error) {
				delete requestTokens[tokenKey];
				if (error instanceof ResponseError) {
					reply(<ResponseError<any>>error);
				} else if (error && is.string(error.message)) {
					replyError(new ResponseError<void>(ErrorCodes.InternalError, `Request ${requestMessage.method} failed with message: ${error.message}`));
				} else {
					replyError(new ResponseError<void>(ErrorCodes.InternalError, `Request ${requestMessage.method} failed unexpectedly without providing any details.`));
				}
			}
		} else {
			replyError(new ResponseError<void>(ErrorCodes.MethodNotFound, `Unhandled method ${requestMessage.method}`));
		}
	}

	function handleResponse(responseMessage: ResponseMessage) {
		let key = String(responseMessage.id);
		let responsePromise = responsePromises[key];
		if (trace != Trace.Off && tracer) {
			traceResponse(responseMessage, responsePromise);
		}
		if (responsePromise) {
			delete responsePromises[key];
			try {
				if (is.defined(responseMessage.error)) {
					responsePromise.reject(responseMessage.error);
				} else if (is.defined(responseMessage.result)) {
					responsePromise.resolve(responseMessage.result);
				} else {
					throw new Error('Should never happen.');
				}
			} catch (error) {
				if (error.message) {
					 logger.error(`Response handler '${responsePromise.method}' failed with message: ${error.message}`);
				} else {
					logger.error(`Response handler '${responsePromise.method}' failed unexpectedly.`);
				}
			}
		}
	}

	function handleNotification(message: NotificationMessage) {
		let eventHandler: NotificationHandler<any>;
		if (message.method === CancelNotification.type.method) {
			eventHandler = (params: CancelParams) => {
				let id = params.id;
				let source = requestTokens[String(id)];
				if (source) {
					source.cancel();
				}
			}
		} else {
			eventHandler = eventHandlers[message.method];
		}
		if (eventHandler) {
			try {
				eventHandler(message.params);
			} catch (error) {
				if (error.message) {
					 logger.error(`Notification handler '${message.method}' failed with message: ${error.message}`);
				} else {
					logger.error(`Notification handler '${message.method}' failed unexpectedly.`);
				}
			}
		}
	}

	function handleInvalidMessage(message: Message) {
		if (!message) {
			logger.error('Received empty message.');
			return;
		}
		logger.error(`Recevied message which is neither a response nor a notification message:\n${JSON.stringify(message, null, 4)}`);
		// Test whether we find an id to reject the promise
		let responseMessage: ResponseMessage = message as ResponseMessage;
		if (is.string(responseMessage.id) || is.number(responseMessage.id)) {
			let key = String(responseMessage.id);
			let responseHandler = responsePromises[key];
			if (responseHandler) {
				responseHandler.reject(new Error('The received response has neither a result nor an error property.'));
			}
		}
	}

	function traceRequest(message: RequestMessage): void {
		tracer.log(`[${(new Date().toLocaleTimeString())}] Sending request '${message.method} - (${message.id})'.`);
		if (trace === Trace.Verbose && message.params) {
			tracer.log(`Params: ${JSON.stringify(message.params, null, 4)}\n\n`)
		}
	}

	function traceNotification(message: NotificationMessage): void {
		tracer.log(`[${(new Date().toLocaleTimeString())}] Sending notification '${message.method}'.`);
		if (trace === Trace.Verbose) {
			if (message.params) {
				tracer.log(`Params: ${JSON.stringify(message.params, null, 4)}\n\n`)
			} else {
				tracer.log('No parameters provided.\n\n');
			}
		}
	}

	function traceResponse(message: ResponseMessage, responsePromise: ResponsePromise): void {
		if (responsePromise) {
			let error = message.error ? ` Request failed: ${message.error.message} (${message.error.code}).` : '';
			tracer.log(`[${(new Date().toLocaleTimeString())}] Recevied response '${responsePromise.method} - (${message.id})' in ${Date.now() - responsePromise.timerStart}ms.${error}`);
		} else {
			tracer.log(`[${(new Date().toLocaleTimeString())}] Recevied response ${message.id} without active response promise.`);
		}
		if (trace === Trace.Verbose) {
			if (message.error && message.error.data) {
				tracer.log(`Error data: ${JSON.stringify(message.error.data, null, 4)}\n\n`)
			} else {
				if (message.result) {
					tracer.log(`Result: ${JSON.stringify(message.result, null, 4)}\n\n`);
				} else {
					tracer.log('No result returned.\n\n');
				}
			}
		}
	}

	let callback: DataCallback = (message) => {
		if (isRequestMessage(message)) {
			handleRequest(message);
		} else if (isReponseMessage(message)) {
			handleResponse(message)
		} else if (isNotificationMessage(message)) {
			handleNotification(message);
		} else {
			handleInvalidMessage(message);
		}
	};

	let connection: MessageConnection = {
		sendNotification: <P>(type: NotificationType<P>, params): void  => {
			let notificatioMessage : NotificationMessage = {
				jsonrpc: version,
				method: type.method,
				params: params
			}
			if (trace != Trace.Off && tracer) {
				traceNotification(notificatioMessage);
			}
			messageWriter.write(notificatioMessage);
		},
		onNotification: <P>(type: NotificationType<P>, handler: NotificationHandler<P>) => {
			eventHandlers[type.method] = handler;
		},
		sendRequest: <P, R, E>(type: RequestType<P, R, E>, params: P, token?:CancellationToken) => {
			let id = sequenceNumber++;
			let result = new Promise<R | ResponseError<E>>((resolve, reject) => {
				let requestMessage : RequestMessage = {
					jsonrpc: version,
					id: id,
					method: type.method,
					params: params
				}
				let responsePromise: ResponsePromise = { method: type.method, timerStart: Date.now(), resolve, reject };
				if (trace != Trace.Off && tracer) {
					traceRequest(requestMessage);
				}
				try {
					messageWriter.write(requestMessage);
				} catch (e) {
					// Writing the message failed. So we need to reject the promise.
					responsePromise.reject(new ResponseError<void>(ErrorCodes.MessageWriteError, e.message ? e.message : 'Unknown reason'));
					responsePromise = null;
				}
				if (responsePromise) {
					responsePromises[String(id)] = responsePromise;
				}
			});
			if (token) {
				token.onCancellationRequested((event) => {
					connection.sendNotification(CancelNotification.type, { id });
				});
			}
			return result;
		},
		onRequest: <P, R, E>(type: RequestType<P, R, E>, handler: RequestHandler<P, R, E>) => {
			requestHandlers[type.method] = handler;
		},
		trace: (_value: Trace, _tracer: Tracer) => {
			trace = _value;
			if (trace === Trace.Off) {
				tracer = null;
			} else {
				tracer = _tracer;
			}
		},
		onError: errorEmitter.event,
		onClose: closeEmitter.event,
		dispose: () => {
		},
		listen: () => {
			messageReader.listen(callback);
		}
	};
	return connection as T;
}

function isMessageReader(value: any): value is MessageReader {
	return is.defined(value.listen) && is.undefined(value.read);
}

function isMessageWriter(value: any): value is MessageWriter {
	return is.defined(value.write) && is.undefined(value.end);
}

export function createServerMessageConnection(reader: MessageReader, writer: MessageWriter, logger: Logger): ServerMessageConnection;
export function createServerMessageConnection(inputStream: NodeJS.ReadableStream, outputStream: NodeJS.WritableStream, logger: Logger): ServerMessageConnection;
export function createServerMessageConnection(input: MessageReader | NodeJS.ReadableStream, output: MessageWriter | NodeJS.WritableStream, logger: Logger): ServerMessageConnection {
	let reader = isMessageReader(input) ? input : new StreamMessageReader(input);
	let writer = isMessageWriter(output) ? output : new StreamMessageWriter(output);
	return createMessageConnection<ServerMessageConnection>(reader, writer, logger);
}

export function createClientMessageConnection(reader: MessageReader, writer: MessageWriter, logger: Logger): ClientMessageConnection;
export function createClientMessageConnection(inputStream: NodeJS.ReadableStream, outputStream: NodeJS.WritableStream, logger: Logger): ClientMessageConnection;
export function createClientMessageConnection(input: MessageReader | NodeJS.ReadableStream, output: MessageWriter | NodeJS.WritableStream, logger: Logger): ClientMessageConnection {
	let reader = isMessageReader(input) ? input : new StreamMessageReader(input);
	let writer = isMessageWriter(output) ? output : new StreamMessageWriter(output);
	return createMessageConnection<ClientMessageConnection>(reader, writer, logger, true);
}