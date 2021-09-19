/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';

export default class ProtocolCodeAction extends vscode.CodeAction {

	public readonly data: unknown | undefined;

	constructor(title: string, data: unknown | undefined) {
		super(title);
		this.data = data;
	}
}