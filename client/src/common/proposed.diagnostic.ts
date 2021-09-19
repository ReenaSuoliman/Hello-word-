/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	Disposable, languages as Languages, window as Window, CancellationToken, ProviderResult,
	Diagnostic as VDiagnostic, CancellationTokenSource, TextDocument, CancellationError, Event as VEvent, EventEmitter
} from 'vscode';

import {
	Proposed, ClientCapabilities, ServerCapabilities, DocumentSelector, DidOpenTextDocumentNotification, DidChangeTextDocumentNotification,
	DidSaveTextDocumentNotification, DidCloseTextDocumentNotification
} from 'vscode-languageserver-protocol';

import {
	TextDocumentFeature, BaseLanguageClient, Middleware, LSPCancellationError, DiagnosticPullMode
} from './client';

function ensure<T, K extends keyof T>(target: T, key: K): T[K] {
	if (target[key] === void 0) {
		target[key] = {} as any;
	}
	return target[key];
}

export type VDiagnosticResult = {
	items: VDiagnostic[];
} | {
	unmodified: true
};

export namespace VDiagnosticResult {
	export function hasItems(value: VDiagnosticResult): value is VDiagnosticResult & { items: VDiagnostic[]; } {
		const candidate = value as VDiagnosticResult & { items: VDiagnostic[]; };
		return candidate && Array.isArray(candidate.items);
	}
}

export interface DiagnosticProvider {
	onDidChangeDiagnostics: VEvent<void>;
	provideDiagnostics (textDocument: TextDocument, token: CancellationToken): ProviderResult<VDiagnosticResult>;
}

export interface ProvideDiagnosticSignature {
	(this: void, textDocument: TextDocument, token: CancellationToken): ProviderResult<VDiagnosticResult>;
}

export interface DiagnosticProviderMiddleware {
	provideDiagnostics?: (this: void, document: TextDocument, token: CancellationToken, next: ProvideDiagnosticSignature) => ProviderResult<VDiagnosticResult>;
}


enum RequestStateKind {
	active = 'open',
	reschedule = 'reschedule',
	outDated = 'drop'
}

type RequestState = {
	state: RequestStateKind.active;
	textDocument: TextDocument;
	tokenSource: CancellationTokenSource;
} | {
	state: RequestStateKind.reschedule;
	textDocument: TextDocument;
} | {
	state: RequestStateKind.outDated;
	textDocument: TextDocument;
};

export interface DiagnosticFeatureProvider {
	onDidChangeDiagnosticsEmitter: EventEmitter<void>;
	provider: DiagnosticProvider;
}

class DiagnosticFeatureProviderImpl implements DiagnosticFeatureProvider {

	public readonly onDidChangeDiagnosticsEmitter: EventEmitter<void>;
	public readonly provider: DiagnosticProvider;
	public readonly disposable: Disposable;

	constructor(client: BaseLanguageClient, options: Proposed.DiagnosticRegistrationOptions) {
		const diagnosticPullOptions = client.clientOptions.diagnosticPullOptions ?? { onType: true, onSave: false };
		const documentSelector = options.documentSelector!;
		const disposables: Disposable[] = [];
		const collection = Languages.createDiagnosticCollection(options.identifier);
		disposables.push(collection);
		const availableEditors: Set<string> = new Set();
		const managedDocuments: Map<string, TextDocument> = new Map();

		const matches = (textDocument: TextDocument): boolean => {
			return Languages.match(documentSelector, textDocument) > 0 && availableEditors.has(textDocument.uri.toString());
		};

		const manages = (textDocument: TextDocument): boolean => {
			return managedDocuments.has(textDocument.uri.toString());
		};

		this.onDidChangeDiagnosticsEmitter = new EventEmitter<void>();
		this.provider = {
			onDidChangeDiagnostics: this.onDidChangeDiagnosticsEmitter.event,
			provideDiagnostics: (textDocument, token) => {
				const provideDiagnostics: ProvideDiagnosticSignature = (textDocument, token) => {
					const params: Proposed.DiagnosticParams = {
						textDocument: { uri: client.code2ProtocolConverter.asUri(textDocument.uri) }
					};
					return client.sendRequest(Proposed.DocumentDiagnosticRequest.type, params, token).then((result) => {
						if (result === null || !result.items) {
							return { items: [] };
						}
						return { items: client.protocol2CodeConverter.asDiagnostics(result.items) };
					}, (error) => {
						return client.handleFailedRequest(Proposed.DocumentDiagnosticRequest.type, token, error, { items: [] });
					});
				};
				const middleware: Middleware & DiagnosticProviderMiddleware = client.clientOptions.middleware!;
				return middleware.provideDiagnostics
					? middleware.provideDiagnostics(textDocument, token, provideDiagnostics)
					: provideDiagnostics(textDocument, token);
			}
		};

		const requestStates: Map<string, RequestState> = new Map();
		const pullDiagnostics = async (textDocument: TextDocument): Promise<void> => {
			const key = textDocument.uri.toString();
			const currentState = requestStates.get(key);
			if (currentState !== undefined) {
				if (currentState.state === RequestStateKind.active) {
					currentState.tokenSource.cancel();
				}
				requestStates.set(key, { state: RequestStateKind.reschedule, textDocument });
				// We have a state. Wait until the request returns.
				return;
			}
			const tokenSource = new CancellationTokenSource();
			requestStates.set(key, { state: RequestStateKind.active, textDocument, tokenSource });
			let diagnostics: VDiagnosticResult | undefined;
			let afterState: RequestState | undefined;
			try {
				diagnostics = await this.provider.provideDiagnostics(textDocument, tokenSource.token) ?? { items: [] };
			} catch (error: unknown) {
				if (error instanceof LSPCancellationError && Proposed.DiagnosticServerCancellationData.is(error.data) && error.data.retriggerRequest === false) {
					afterState = { state: RequestStateKind.outDated, textDocument };
				}
				if (afterState === undefined && error instanceof CancellationError) {
					afterState = { state: RequestStateKind.reschedule, textDocument };
				} else {
					throw error;
				}
			}
			afterState = afterState ?? requestStates.get(key);
			if (afterState === undefined) {
				// This shouldn't happen. Log it
				client.error(`Lost request state in diagnostic pull model. Clearing diagnostics for ${key}`);
				collection.delete(textDocument.uri);
				return;
			}
			requestStates.delete(key);
			if (afterState.state === RequestStateKind.outDated || !manages(textDocument)) {
				return;
			}
			// diagnostics is only undefined if the request has thrown.
			if (diagnostics !== undefined && VDiagnosticResult.hasItems(diagnostics)) {
				collection.set(textDocument.uri, diagnostics.items);
			}
			if (afterState.state === RequestStateKind.reschedule) {
				pullDiagnostics(textDocument);
			}
		};

		const openEditorsHandler = () => {
			availableEditors.clear();
			for (const info of Window.openEditors) {
				availableEditors.add(info.resource.toString());
			}
		};
		openEditorsHandler();
		disposables.push(Window.onDidChangeOpenEditors(openEditorsHandler));

		// We always pull on open.
		const openFeature = client.getFeature(DidOpenTextDocumentNotification.method);
		disposables.push(openFeature.onNotificationSent((event) => {
			const textDocument = event.original;
			if (matches(textDocument)) {
				managedDocuments.set(textDocument.uri.toString(), textDocument);
				pullDiagnostics(event.original);
			}
		}));
		// Pull all diagnostics for documents that are already open
		for (const textDocument of openFeature.openDocuments) {
			if (matches(textDocument)) {
				managedDocuments.set(textDocument.uri.toString(), textDocument);
				pullDiagnostics(textDocument);
			}
		}

		if (diagnosticPullOptions.onType) {
			const changeFeature = client.getFeature(DidChangeTextDocumentNotification.method);
			disposables.push(changeFeature.onNotificationSent((event) => {
				const textDocument = event.original.document;
				if ((diagnosticPullOptions.filter === undefined || !diagnosticPullOptions.filter(textDocument, DiagnosticPullMode.onType)) && manages(textDocument) && event.original.contentChanges.length > 0) {
					pullDiagnostics(textDocument);
				}
			}));
		}
		if (diagnosticPullOptions.onSave) {
			const saveFeature = client.getFeature(DidSaveTextDocumentNotification.method);
			disposables.push(saveFeature.onNotificationSent((event) => {
				const textDocument = event.original;
				if ((diagnosticPullOptions.filter === undefined || !diagnosticPullOptions.filter(textDocument, DiagnosticPullMode.onSave)) && manages(textDocument)) {
					pullDiagnostics(event.original);
				}
			}));
		}

		// WHen the document closes clear things up
		const closeFeature = client.getFeature(DidCloseTextDocumentNotification.method);
		disposables.push(closeFeature.onNotificationSent((event) => {
			const textDocument = event.original;
			const requestState = requestStates.get(textDocument.uri.toString());
			if (requestState !== undefined) {
				requestStates.set(textDocument.uri.toString(),{ state: RequestStateKind.outDated, textDocument });
			}
			if (manages(textDocument)) {
				collection.delete(textDocument.uri);
				managedDocuments.delete(textDocument.uri.toString());
			}
		}));
		this.onDidChangeDiagnosticsEmitter.event(() => {
			for (const document of managedDocuments.values()) {
				pullDiagnostics(document);
			}
		});

		this.disposable = Disposable.from(...disposables);
	}
}

export class DiagnosticFeature extends TextDocumentFeature<boolean | Proposed.DiagnosticOptions, Proposed.DiagnosticRegistrationOptions, DiagnosticFeatureProvider> {

	constructor(client: BaseLanguageClient) {
		super(client, Proposed.DocumentDiagnosticRequest.type);
	}

	public fillClientCapabilities(capabilities: ClientCapabilities & Proposed.$DiagnosticClientCapabilities): void {
		let capability = ensure(ensure(capabilities, 'textDocument')!, 'diagnostic')!;
		capability.dynamicRegistration = true;
	}

	public initialize(capabilities: ServerCapabilities & Proposed.$DiagnosticServerCapabilities, documentSelector: DocumentSelector): void {
		const client = this._client;
		client.onRequest(Proposed.DiagnosticRefreshRequest.type, async () => {
			for (const provider of this.getAllProviders()) {
				provider.onDidChangeDiagnosticsEmitter.fire();
			}
		});
		let [id, options] = this.getRegistration(documentSelector, capabilities.diagnosticProvider);
		if (!id || !options) {
			return;
		}
		this.register({ id: id, registerOptions: options });
	}

	protected registerLanguageProvider(options: Proposed.DiagnosticRegistrationOptions): [Disposable, DiagnosticFeatureProvider] {
		const provider = new DiagnosticFeatureProviderImpl(this._client, options);
		return [provider.disposable, provider];
	}
}