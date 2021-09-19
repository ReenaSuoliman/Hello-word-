/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { languages as Languages, Disposable, TextDocument, ProviderResult, Position as VPosition, Declaration as VDeclaration } from 'vscode';

import {
	ClientCapabilities, CancellationToken, ServerCapabilities, DocumentSelector, DeclarationRequest
} from 'vscode-languageserver-protocol';

import { TextDocumentFeature, BaseLanguageClient } from './client';
import { DeclarationRegistrationOptions, DeclarationOptions } from 'vscode-languageserver-protocol/lib/protocol.declaration';

function ensure<T, K extends keyof T>(target: T, key: K): T[K] {
	if (target[key] === void 0) {
		target[key] = {} as any;
	}
	return target[key];
}

export interface ProvideDeclarationSignature {
	(document: TextDocument, position: VPosition, token: CancellationToken): ProviderResult<VDeclaration>;
}

export interface DeclarationMiddleware {
	provideDeclaration?: (this: void, document: TextDocument, position: VPosition, token: CancellationToken, next: ProvideDeclarationSignature) => ProviderResult<VDeclaration>;
}

export class DeclarationFeature extends TextDocumentFeature<boolean | DeclarationOptions, DeclarationRegistrationOptions> {

	constructor(client: BaseLanguageClient) {
		super(client, DeclarationRequest.type);
	}

	public fillClientCapabilities(capabilites: ClientCapabilities): void {
		let declarationSupport = ensure(ensure(capabilites, 'textDocument')!, 'declaration')!;
		declarationSupport.dynamicRegistration = true;
		declarationSupport.linkSupport = true;
	}

	public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
		let [id, options] = this.getRegistration(documentSelector, capabilities.declarationProvider);
		if (!id || !options) {
			return;
		}
		this.register(this.messages, { id: id, registerOptions: options });
	}

	protected registerLanguageProvider(options: DeclarationRegistrationOptions): Disposable {
		let client = this._client;
		let provideDeclaration: ProvideDeclarationSignature = (document, position, token) => {
			return client.sendRequest(DeclarationRequest.type, client.code2ProtocolConverter.asTextDocumentPositionParams(document, position), token).then(
				client.protocol2CodeConverter.asDeclarationResult,
				(error) => {
					client.logFailedRequest(DeclarationRequest.type, error);
					return Promise.resolve(null);
				}
			);
		};
		let middleware = client.clientOptions.middleware!;
		return Languages.registerDeclarationProvider(options.documentSelector!, {
			provideDeclaration: (document: TextDocument, position: VPosition, token: CancellationToken): ProviderResult<VDeclaration> => {
				return middleware.provideDeclaration
					? middleware.provideDeclaration(document, position, token, provideDeclaration)
					: provideDeclaration(document, position, token);
			}
		});
	}
}