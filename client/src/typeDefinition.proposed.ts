/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as UUID from './utils/uuid';
import * as Is from  './utils/is';

import { languages as Languages, Disposable, TextDocument, ProviderResult, Position as VPosition, Definition as VDefinition } from 'vscode';

import {
	ClientCapabilities, Proposed, CancellationToken, ServerCapabilities, TextDocumentRegistrationOptions, DocumentSelector
} from 'vscode-languageserver-protocol';

import { TextDocumentFeature, BaseLanguageClient } from './client';

function ensure<T, K extends keyof T>(target: T, key: K): T[K] {
	if (target[key] === void 0) {
		target[key] = {} as any;
	}
	return target[key];
}

export interface ProvideTypeDefinitionSignature {
	(document: TextDocument, position: VPosition, token: CancellationToken): ProviderResult<VDefinition>;
}

export interface TypeDefinitionMiddleware {
	provideTypeDefinition?: (this: void, document: TextDocument, position: VPosition, token: CancellationToken, next: ProvideTypeDefinitionSignature) => ProviderResult<VDefinition>;
}

export class TypeDefinitionFeature extends TextDocumentFeature<TextDocumentRegistrationOptions> {

	constructor(client: BaseLanguageClient) {
		super(client, Proposed.TypeDefinitionRequest.type);
	}

	public fillClientCapabilities(cap: ClientCapabilities): void {
		let capabilites = cap as ClientCapabilities & Proposed.TypeDefinitionClientCapabilities;
		ensure(ensure(capabilites, 'textDocument')!, 'typeDefinition')!.dynamicRegistration = true;
	}

	public initialize(cap: ServerCapabilities, documentSelector: DocumentSelector): void {
		let capabilities = cap as ServerCapabilities & Proposed.TypeDefinitionServerCapabilities;

		if (!capabilities.typeDefinitionProvider) {
			return;
		}
		if (capabilities.typeDefinitionProvider === true) {
			if (!documentSelector) {
				return;
			}
			this.register(this.messages, {
				id: UUID.generateUuid(),
				registerOptions: Object.assign({}, { documentSelector: documentSelector })
			});
		} else {
			const implCapabilities = capabilities.typeDefinitionProvider;
			const id = Is.string(implCapabilities.id) && implCapabilities.id.length > 0 ? implCapabilities.id : UUID.generateUuid();
			const selector = implCapabilities.documentSelector || documentSelector;
			if (selector) {
				this.register(this.messages, {
					id,
					registerOptions: Object.assign({}, { documentSelector: selector })
				});
			}
		}
	}

	protected registerLanguageProvider(options: TextDocumentRegistrationOptions): Disposable {
		let client = this._client;
		let provideDefinition: ProvideTypeDefinitionSignature = (document, position, token) => {
			return client.sendRequest(Proposed.TypeDefinitionRequest.type, client.code2ProtocolConverter.asTextDocumentPositionParams(document, position), token).then(
				client.protocol2CodeConverter.asDefinitionResult,
				(error) => {
					client.logFailedRequest(Proposed.TypeDefinitionRequest.type, error);
					return Promise.resolve(null);
				}
			);
		};
		let middleware = client.clientOptions.middleware!;
		return Languages.registerTypeDefinitionProvider(options.documentSelector!, {
			provideTypeDefinition: (document: TextDocument, position: VPosition, token: CancellationToken): ProviderResult<VDefinition> => {
				return middleware.provideDefinition
					? middleware.provideDefinition(document, position, token, provideDefinition)
					: provideDefinition(document, position, token);
			}
		});
	}
}


