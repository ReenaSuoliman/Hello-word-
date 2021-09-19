/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { TextDocumentIdentifier, Range } from 'vscode-languageserver-types';

import { ProtocolRequestType, ProtocolNotificationType0 } from './messages';
import { PartialResultParams, WorkDoneProgressParams, WorkDoneProgressOptions, TextDocumentRegistrationOptions, StaticRegistrationOptions } from './protocol';

/**
 * A set of predefined token types. This set is not fixed
 * an clients can specify additional token types via the
 * corresponding client capabilities.
 *
 * @since 3.16.0 - Proposed state
 */
export enum SemanticTokenTypes {
	namespace = 'namespace',
	type = 'type',
	class = 'class',
	enum = 'enum',
	interface = 'interface',
	struct = 'struct',
	typeParameter = 'typeParameter',
	parameter = 'parameter',
	variable = 'variable',
	property = 'property',
	enumMember = 'enumMember',
	event = 'event',
	function = 'function',
	member = 'member',
	macro = 'macro',
	keyword = 'keyword',
	modifier = 'modifier',
	comment = 'comment',
	string = 'string',
	number = 'number',
	regexp = 'regexp',
	operator = 'operator'
}

/**
 * A set of predefined token modifiers. This set is not fixed
 * an clients can specify additional token types via the
 * corresponding client capabilities.
 *
 * @since 3.16.0 - Proposed state
 */
export enum SemanticTokenModifiers {
	declaration = 'declaration',
	definition = 'definition',
	readonly = 'readonly',
	static = 'static',
	deprecated = 'deprecated',
	abstract = 'abstract',
	async = 'async',
	modification = 'modification',
	documentation = 'documentation',
	defaultLibrary = 'defaultLibrary'
}

/**
 * @since 3.16.0 - Proposed state
 */
export interface SemanticTokensLegend {
	/**
	 * The token types a server uses.
	 */
	tokenTypes: string[];

	/**
	 * The token modifiers a server uses.
	 */
	tokenModifiers: string[];
}

/**
 * @since 3.16.0 - Proposed state
 */
export interface SemanticTokens {
	/**
	 * An optional result id. If provided and clients support delta updating
	 * the client will include the result id in the next semantic token request.
	 * A server can then instead of computing all semantic tokens again simply
	 * send a delta.
	 */
	resultId?: string;

	/**
	 * The actual tokens.
	 */
	data: number[];
}

/**
 * @since 3.16.0 - Proposed state
 */
export namespace SemanticTokens {
	export function is(value: any): value is SemanticTokens {
		const candidate = value as SemanticTokens;
		return candidate !== undefined && (candidate.resultId === undefined || typeof candidate.resultId === 'string') &&
			Array.isArray(candidate.data) && (candidate.data.length === 0 || typeof candidate.data[0] === 'number');
	}
}

/**
 * @since 3.16.0 - Proposed state
 */
export interface SemanticTokensPartialResult {
	data: number[];
}

/**
 * @since 3.16.0 - Proposed state
 */
export interface SemanticTokensEdit {
	/**
	 * The start offset of the edit.
	 */
	start: number;

	/**
	 * The count of elements to remove.
	 */
	deleteCount: number;

	/**
	 * The elements to insert.
	 */
	data?: number[];
}

/**
 * @since 3.16.0 - Proposed state
 */
export interface SemanticTokensDelta {
	readonly resultId?: string;
	/**
	 * The semantic token edits to transform a previous result into a new result.
	 */
	edits: SemanticTokensEdit[];
}

/**
 * @since 3.16.0 - Proposed state
 */
export interface SemanticTokensDeltaPartialResult {
	edits: SemanticTokensEdit[]
}

//------- 'textDocument/semanticTokens' -----

export namespace TokenFormat {
	export const Relative: 'relative' = 'relative';
}

export type TokenFormat = 'relative';

/**
 * @since 3.16.0 - Proposed state
 */
export interface SemanticTokensClientCapabilities {
	/**
	 * The text document client capabilities
	 */
	textDocument?: {
		/**
		 * Capabilities specific to the `textDocument/semanticTokens`
		 *
		 * @since 3.16.0 - Proposed state
		 */
		semanticTokens?: {
			/**
			 * Whether implementation supports dynamic registration. If this is set to `true`
			 * the client supports the new `(TextDocumentRegistrationOptions & StaticRegistrationOptions)`
			 * return value for the corresponding server capability as well.
			 */
			dynamicRegistration?: boolean;

			/**
			 * Whether the client implementation supports a refresh notification to refresh all semantic
			 * token models. This is useful if a server detects a project wide configuration change which
			 * requires a re-calculation of all semantic tokens.
			 */
			refreshNotification?: boolean;

			/**
			 * Which requests the client supports and might send to the server
			 */
			requests: {
				/**
				 * The client will send the `textDocument/semanticTokens/range` request if
				 * the server provides a corresponding handler.
				 */
				range?: boolean | {
				};

				/**
				 * The client will send the `textDocument/semanticTokens/full` request if
				 * the server provides a corresponding handler.
				 */
				full?: boolean | {
					/**
					 * The client will send the `textDocument/semanticTokens/full/delta` request if
					 * the server provides a corresponding handler.
					*/
					delta?: boolean
				}
			}

			/**
			 * The token types that the client supports.
			 */
			tokenTypes: string[];

			/**
			 * The token modifiers that the client supports.
			 */
			tokenModifiers: string[];

			/**
			 * The formats the clients supports.
			 */
			formats: TokenFormat[];
		};
	}
}

/**
 * @since 3.16.0 - Proposed state
 */
export interface SemanticTokensOptions extends WorkDoneProgressOptions {
	/**
	 * The legend used by the server
	 */
	legend: SemanticTokensLegend;

	/**
	 * Server supports providing semantic tokens for a sepcific range
	 * of a document.
	 */
	range?: boolean | {
	};

	/**
	 * Server supports providing semantic tokens for a full document.
	 */
	full?: boolean | {
		/**
		 * The server supports deltas for full documents.
		 */
		delta?: boolean;
	}
}

/**
 * @since 3.16.0 - Proposed state
 */
export interface SemanticTokensRegistrationOptions extends TextDocumentRegistrationOptions, SemanticTokensOptions, StaticRegistrationOptions {
}

//------- 'textDocument/semanticTokens' -----

/**
 * @since 3.16.0 - Proposed state
 */
export interface SemanticTokensParams extends WorkDoneProgressParams, PartialResultParams {
	/**
	 * The text document.
	 */
	textDocument: TextDocumentIdentifier;
}

/**
 * @since 3.16.0 - Proposed state
 */
export namespace SemanticTokensRequest {
	export const method: 'textDocument/semanticTokens/full' = 'textDocument/semanticTokens/full';
	export const type = new ProtocolRequestType<SemanticTokensParams, SemanticTokens | null, SemanticTokensPartialResult, void, SemanticTokensRegistrationOptions>(method);
}

//------- 'textDocument/semanticTokens/edits' -----

/**
 * @since 3.16.0 - Proposed state
 */
export interface SemanticTokensDeltaParams extends WorkDoneProgressParams, PartialResultParams {
	/**
	 * The text document.
	 */
	textDocument: TextDocumentIdentifier;

	/**
	 * The result id of a previous response. The result Id can either point to a full response
	 * or a delta response depending on what was recevied last.
	 */
	previousResultId: string;
}

/**
 * @since 3.16.0 - Proposed state
 */
export namespace SemanticTokensDeltaRequest {
	export const method: 'textDocument/semanticTokens/full/delta' = 'textDocument/semanticTokens/full/delta';
	export const type = new ProtocolRequestType<SemanticTokensDeltaParams, SemanticTokens | SemanticTokensDelta | null, SemanticTokensPartialResult | SemanticTokensDeltaPartialResult, void, SemanticTokensRegistrationOptions>(method);
}

//------- 'textDocument/semanticTokens/range' -----

/**
 * @since 3.16.0 - Proposed state
 */
export interface SemanticTokensRangeParams extends WorkDoneProgressParams, PartialResultParams {
	/**
	 * The text document.
	 */
	textDocument: TextDocumentIdentifier;

	/**
	 * The range the semantic tokens are requested for.
	 */
	range: Range;
}

/**
 * @since 3.16.0 - Proposed state
 */
export namespace SemanticTokensRangeRequest {
	export const method: 'textDocument/semanticTokens/range' = 'textDocument/semanticTokens/range';
	export const type = new ProtocolRequestType<SemanticTokensRangeParams, SemanticTokens | null, SemanticTokensPartialResult, void, void>(method);
}

//------- 'textDocument/semanticTokens/refresh' -----

export namespace SemanticTokensRefreshNotification {
	export const method: `workspace/semanticTokens/refresh` = `workspace/semanticTokens/refresh`;
	export const type = new ProtocolNotificationType0<void>(method);
}