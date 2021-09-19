/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as assert from 'assert';
import { Trace } from '../main';

describe('General Tests', () => {
	it('Trace#fromString', () => {
		assert(Trace.Off === Trace.fromString(10 as any));
	});
});
