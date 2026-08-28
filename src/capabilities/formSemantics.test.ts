import * as assert from 'assert';
import { suite, test } from '../test/tdd';
import {
	buildFormSemantics,
	checkDynamicOptionProperties,
	compileTypedFields,
	isUuid,
	typedFormFieldSchema,
	validateFormFields,
	type RawFormField,
	type TypedFormField,
} from './formSemantics';

const parseTyped = (value: unknown): TypedFormField => typedFormFieldSchema.parse(value);

function codes(diagnostics: { code: string }[]): string[] {
	return diagnostics.map(diagnostic => diagnostic.code);
}

suite('Unit: formSemantics compiler', () => {
	test('compiles a typed text field into canonical Rewst field JSON', () => {
		const { fields, diagnostics } = compileTypedFields([
			parseTyped({
				name: 'company',
				type: 'TEXT_INPUT',
				label: 'Company',
				description: 'Legal entity',
				required: true,
				placeholder: 'Acme',
			}),
		]);
		assert.deepStrictEqual(diagnostics, []);
		assert.deepStrictEqual(fields[0], {
			index: 0,
			type: 'TEXT_INPUT',
			schema: {
				name: 'company',
				type: 'string',
				label: 'Company',
				description: 'Legal entity',
				required: true,
				placeholder: 'Acme',
			},
		});
	});

	test('maps every supported field type to its stored schema type', () => {
		const expected: [string, string][] = [
			['CHECKBOX', 'boolean'],
			['DATE', 'string'],
			['FILE_INPUT', 'string'],
			['MULTILINE_INPUT', 'string'],
			['MULTISELECT', 'array'],
			['NUMBER_INPUT', 'number'],
			['RADIO', 'string'],
			['SELECT', 'string'],
			['TEXT', 'string'],
			['TEXT_INPUT', 'string'],
		];
		for (const [type, schemaType] of expected) {
			const { fields } = compileTypedFields([parseTyped({ name: 'f', type })]);
			assert.strictEqual((fields[0].schema as { type: string }).type, schemaType, type);
		}
	});

	for (const type of ['SELECT', 'MULTISELECT', 'RADIO']) {
		test(`compiles dynamicOptions on ${type} into enumSourceWorkflow with defaults and mappings`, () => {
			const { fields, diagnostics } = compileTypedFields([
				parseTyped({ name: 'refresh_options', type: 'CHECKBOX' }),
				parseTyped({
					name: 'user_to_offboard',
					type,
					label: 'User',
					required: true,
					dynamicOptions: {
						workflowId: 'wf-generator',
						triggerId: 'trigger-1',
						inputFromFields: { skipCache: 'refresh_options' },
					},
				}),
			]);
			assert.deepStrictEqual(diagnostics, []);
			const sourceId = fields[0].id;
			assert.ok(sourceId && isUuid(sourceId), `referenced field needs a UUID id, got ${sourceId}`);
			const schema = fields[1].schema as Record<string, unknown>;
			assert.deepStrictEqual(schema.enumSourceWorkflow, {
				id: 'wf-generator',
				triggerId: 'trigger-1',
				labelKey: 'label',
				valueKey: 'value',
				input: { skipCache: '' },
				inputFromFields: { skipCache: { fieldId: sourceId, isActive: true, isRequired: false } },
			});
			if (type === 'MULTISELECT') {
				assert.strictEqual(schema.type, 'array');
				assert.deepStrictEqual(schema.items, { type: 'string' });
			}
		});
	}

	test('honours explicit label/value keys, static input and per-mapping overrides', () => {
		const { fields } = compileTypedFields([
			parseTyped({ name: 'site', type: 'TEXT_INPUT' }),
			parseTyped({
				name: 'device',
				type: 'SELECT',
				dynamicOptions: {
					workflowId: 'wf',
					labelKey: 'displayName',
					valueKey: 'id',
					input: { tenant_id: 'abc' },
					inputFromFields: { site_id: { fieldName: 'site', isRequired: true, isActive: false } },
				},
			}),
		]);
		assert.deepStrictEqual((fields[1].schema as Record<string, unknown>).enumSourceWorkflow, {
			id: 'wf',
			labelKey: 'displayName',
			valueKey: 'id',
			input: { tenant_id: 'abc', site_id: '' },
			inputFromFields: { site_id: { fieldId: fields[0].id, isActive: false, isRequired: true } },
		});
	});

	test('compiles static options for single-choice and multi-choice fields', () => {
		const { fields } = compileTypedFields([
			parseTyped({
				name: 'plan',
				type: 'SELECT',
				options: [
					{ label: 'Basic', value: 'basic' },
					{ label: 'Pro', value: 'pro' },
				],
			}),
			parseTyped({
				name: 'apps',
				type: 'MULTISELECT',
				options: [{ label: 'Teams', value: 'teams' }],
			}),
		]);
		const single = fields[0].schema as Record<string, unknown>;
		assert.deepStrictEqual(single.enum, ['basic', 'pro']);
		assert.deepStrictEqual(single.enumNames, ['Basic', 'Pro']);
		const multi = fields[1].schema as Record<string, unknown>;
		assert.deepStrictEqual(multi.items, { type: 'string', enum: ['teams'], enumNames: ['Teams'] });
		assert.strictEqual(multi.uniqueItems, true);
	});

	test('compiles conditions to source field ids and rejects unknown sources', () => {
		const good = compileTypedFields([
			parseTyped({ name: 'has_manager', type: 'CHECKBOX' }),
			parseTyped({
				name: 'manager',
				type: 'TEXT_INPUT',
				conditions: [{ action: 'show', sourceFieldName: 'has_manager', requiredValue: true }],
			}),
		]);
		// The condition's source is referenced, so it gets an id; the field that
		// owns the condition is not, so Rewst assigns its id on insert.
		assert.ok(good.fields[0].id && isUuid(good.fields[0].id));
		assert.strictEqual(good.fields[1].id, undefined);
		assert.deepStrictEqual(good.fields[1].conditions, [
			{ action: 'show', index: 0, sourceFieldId: good.fields[0].id, requiredValue: true },
		]);

		const bad = compileTypedFields([
			parseTyped({
				name: 'manager',
				type: 'TEXT_INPUT',
				conditions: [{ action: 'show', sourceFieldName: 'missing' }],
			}),
		]);
		assert.deepStrictEqual(codes(bad.diagnostics), ['condition_unknown_source_field']);
	});

	test('rejects options on a field type that cannot render them, and both option sources at once', () => {
		const onText = compileTypedFields([
			parseTyped({ name: 'note', type: 'TEXT_INPUT', options: [{ label: 'A', value: 'a' }] }),
		]);
		assert.deepStrictEqual(codes(onText.diagnostics), ['options_on_non_option_field']);

		const both = compileTypedFields([
			parseTyped({
				name: 'pick',
				type: 'SELECT',
				options: [{ label: 'A', value: 'a' }],
				dynamicOptions: { workflowId: 'wf' },
			}),
		]);
		assert.deepStrictEqual(codes(both.diagnostics), ['options_and_dynamic_options']);
	});

	test('rejects a mapping that reads a field which is not on the form', () => {
		const { diagnostics } = compileTypedFields([
			parseTyped({
				name: 'device',
				type: 'SELECT',
				dynamicOptions: { workflowId: 'wf', inputFromFields: { site_id: 'no_such_field' } },
			}),
		]);
		assert.deepStrictEqual(codes(diagnostics), ['input_from_field_unknown_source']);
		assert.match(diagnostics[0].path, /dynamicOptions\.inputFromFields\.site_id$/);
		assert.match(diagnostics[0].message, /no_such_field/);
	});
});

suite('Unit: formSemantics typed input rejection', () => {
	test('names the canonical replacement for each obsolete dynamic-options property', () => {
		const diagnostics = checkDynamicOptionProperties(
			{ workflowId: 'wf', labelField: 'name', inputs: {}, dependsOn: ['a'] },
			'typedFields[0].dynamicOptions',
		);
		assert.deepStrictEqual(
			diagnostics.map(diagnostic => [diagnostic.path, diagnostic.code]),
			[
				['typedFields[0].dynamicOptions.labelField', 'dynamic_options_obsolete_property'],
				['typedFields[0].dynamicOptions.inputs', 'dynamic_options_obsolete_property'],
				['typedFields[0].dynamicOptions.dependsOn', 'dynamic_options_obsolete_property'],
			],
		);
		assert.match(diagnostics[0].message, /use "labelKey" instead/);
		assert.match(diagnostics[1].message, /use "input" instead/);
		assert.match(diagnostics[2].message, /use "inputFromFields" instead/);
	});

	test('reports an unrecognised dynamic-options property with the supported list', () => {
		const [diagnostic] = checkDynamicOptionProperties({ nonsense: 1 }, 'typedFields[0].dynamicOptions');
		assert.strictEqual(diagnostic.code, 'dynamic_options_unknown_property');
		assert.match(
			diagnostic.message,
			/Supported: input, inputFromFields, labelKey, triggerId, valueKey, workflowId/,
		);
	});

	test('rejects unknown typed field properties instead of ignoring them', () => {
		assert.throws(() => parseTyped({ name: 'a', type: 'TEXT_INPUT', reqiured: true }), /reqiured/);
		assert.throws(() => parseTyped({ name: 'a', type: 'TEXT_INPUT', schema: {} }), /schema/);
	});

	test('rejects an unsupported field type by name', () => {
		assert.throws(() => parseTyped({ name: 'a', type: 'DROPDOWN' }), /Field type must be one of/);
	});
});

/** Deterministic, valid UUIDs so fixtures read like real Rewst field ids. */
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

suite('Unit: formSemantics validator', () => {
	const textField = (name: string, id = uuid(1)): RawFormField => ({
		id,
		index: 0,
		type: 'TEXT_INPUT',
		schema: { name, type: 'string' },
	});

	test('accepts a well-formed raw field list and lists the checks that passed', () => {
		const report = validateFormFields([textField('company', uuid(1))]);
		assert.strictEqual(report.ok, true);
		assert.deepStrictEqual(report.errors, []);
		assert.ok(report.passedChecks.includes('field_names_valid_and_unique'));
		assert.ok(report.passedChecks.includes('no_field_dependency_cycles'));
		assert.strictEqual(report.fields[0].name, 'company');
		assert.strictEqual(report.fields[0].optionSource, 'none');
	});

	test('rejects missing, malformed and duplicate field names', () => {
		const report = validateFormFields([
			{ id: uuid(1), type: 'TEXT_INPUT', schema: {} },
			{ id: uuid(2), type: 'TEXT_INPUT', schema: { name: '2bad name' } },
			textField('ok', uuid(3)),
			textField('ok', uuid(4)),
		]);
		assert.deepStrictEqual(codes(report.errors), [
			'field_name_missing',
			'field_name_invalid',
			'field_name_duplicate',
		]);
		assert.ok(!report.passedChecks.includes('field_names_valid_and_unique'));
	});

	test('rejects duplicate field ids and unsupported field types', () => {
		const report = validateFormFields([textField('a', uuid(1)), { ...textField('b', uuid(1)), type: 'DROPDOWN' }]);
		assert.deepStrictEqual(codes(report.errors).sort(), ['field_id_duplicate', 'field_type_invalid']);
	});

	test('rejects conditions that read unknown fields or claim the wrong owner', () => {
		const report = validateFormFields([
			{
				...textField('manager', uuid(1)),
				conditions: [
					{ action: 'show', sourceFieldId: uuid(9) },
					{ action: 'sideways', sourceFieldId: uuid(1) },
					{ action: 'show', fieldId: uuid(2), sourceFieldId: uuid(1) },
				],
			},
		]);
		assert.deepStrictEqual(codes(report.errors), [
			'condition_unknown_source_field',
			'condition_action_invalid',
			'condition_field_id_mismatch',
		]);
	});

	test('rejects a generator whose mapping or workflow id cannot be resolved', () => {
		const report = validateFormFields([
			{
				id: uuid(1),
				type: 'SELECT',
				schema: {
					name: 'device',
					enumSourceWorkflow: {
						id: '',
						labelKey: '',
						inputFromFields: { site_id: { fieldId: uuid(9) }, tenant: {} },
					},
				},
			},
		]);
		assert.deepStrictEqual(codes(report.errors).sort(), [
			'generator_key_invalid',
			'generator_workflow_id_missing',
			'input_from_field_missing_field_id',
			'input_from_field_unknown_source',
		]);
		assert.strictEqual(report.fields[0].optionSource, 'workflow');
	});

	test('rejects workflow-generated options on a field type that cannot show them', () => {
		const report = validateFormFields([
			{ id: uuid(1), type: 'TEXT_INPUT', schema: { name: 'x', enumSourceWorkflow: { id: 'wf' } } },
		]);
		assert.deepStrictEqual(codes(report.errors), ['generator_on_non_option_field']);
	});

	test('warns about an option field with no options at all', () => {
		const report = validateFormFields([{ id: uuid(1), type: 'SELECT', schema: { name: 'x' } }]);
		assert.strictEqual(report.ok, true);
		assert.deepStrictEqual(codes(report.warnings), ['option_field_without_options']);
	});

	test('detects a dependency cycle between generator inputs', () => {
		const report = validateFormFields([
			{
				id: uuid(1),
				type: 'SELECT',
				schema: { name: 'a', enumSourceWorkflow: { id: 'wf', inputFromFields: { in: { fieldId: uuid(2) } } } },
			},
			{
				id: uuid(2),
				type: 'SELECT',
				schema: { name: 'b', enumSourceWorkflow: { id: 'wf', inputFromFields: { in: { fieldId: uuid(1) } } } },
			},
		]);
		assert.deepStrictEqual(codes(report.errors), ['field_dependency_cycle']);
		assert.match(report.errors[0].message, /a -> b -> a/);
		assert.ok(!report.passedChecks.includes('no_field_dependency_cycles'));
	});

	test('preserves unmodelled Rewst metadata on raw fields instead of discarding it', () => {
		const stored: RawFormField = {
			id: uuid(1),
			index: 3,
			type: 'TEXT_INPUT',
			formId: 'form-1',
			createdAt: '2026-01-01',
			schema: { name: 'a', someFutureRewstKey: { nested: true } },
		};
		const { fields, report } = buildFormSemantics({ fields: [stored] });
		assert.strictEqual(report.ok, true);
		assert.deepStrictEqual(fields[0], stored);
	});

	test('buildFormSemantics compiles typed fields and reports compiler errors first', () => {
		const { fields, report } = buildFormSemantics({
			typedFields: [
				parseTyped({
					name: 'device',
					type: 'SELECT',
					dynamicOptions: { workflowId: 'wf', inputFromFields: { site: 'ghost' } },
				}),
			],
		});
		assert.strictEqual(report.ok, false);
		assert.strictEqual(report.errors[0].code, 'input_from_field_unknown_source');
		assert.strictEqual(fields.length, 1);
	});

	test('does not report a generator mapping check as passed when compilation finds an unknown source', () => {
		const { report } = buildFormSemantics({
			typedFields: [
				parseTyped({
					name: 'device',
					type: 'SELECT',
					dynamicOptions: { workflowId: 'wf', inputFromFields: { site: 'ghost' } },
				}),
			],
		});
		assert.ok(!report.passedChecks.includes('generator_mappings_reference_known_fields'));
		assert.ok(!report.fields[0].passedChecks.includes('generator_mappings_reference_known_fields'));
	});
});

suite('Unit: formSemantics field-level reporting', () => {
	test('a compiler error appears on the field that produced it, not only at the top level', () => {
		const { report } = buildFormSemantics({
			typedFields: [
				parseTyped({ name: 'ok_field', type: 'TEXT_INPUT' }),
				parseTyped({
					name: 'device',
					type: 'SELECT',
					dynamicOptions: { workflowId: 'wf', inputFromFields: { site: 'ghost' } },
				}),
			],
		});
		const deviceReport = report.fields.find(field => field.name === 'device');
		assert.deepStrictEqual(codes(deviceReport?.errors ?? []), ['input_from_field_unknown_source']);
		assert.deepStrictEqual(report.fields.find(field => field.name === 'ok_field')?.errors, []);
	});
});

suite('Unit: formSemantics field ids are Rewst UUIDs', () => {
	test('a minted field id is a UUID, never a slug derived from the field name', () => {
		// Regression: field ids were compiled as `field_<name>`, which Rewst
		// rejected with `invalid input syntax for type uuid` because FormField.id
		// is a uuid column that takes the supplied value directly.
		const { fields } = compileTypedFields([
			parseTyped({ name: 'first_name', type: 'TEXT_INPUT' }),
			parseTyped({ name: 'section_personal', type: 'TEXT', content: '## Personal' }),
			parseTyped({
				name: 'manager',
				type: 'SELECT',
				dynamicOptions: { workflowId: 'wf', inputFromFields: { name: 'first_name' } },
			}),
		]);
		for (const field of fields) {
			if (field.id !== undefined) assert.ok(isUuid(field.id), `field id must be a UUID, got "${field.id}"`);
			assert.ok(!/^field_/.test(field.id ?? ''), 'no id is derived from the field name');
		}
		const mapping = (
			fields[2].schema as { enumSourceWorkflow: { inputFromFields: Record<string, { fieldId: string }> } }
		).enumSourceWorkflow.inputFromFields.name;
		assert.strictEqual(mapping.fieldId, fields[0].id, 'the mapping points at the referenced field');
		assert.ok(isUuid(mapping.fieldId));
	});

	test('an unreferenced field is created without an id so Rewst assigns one', () => {
		const { fields } = compileTypedFields([
			parseTyped({ name: 'first_name', type: 'TEXT_INPUT' }),
			parseTyped({ name: 'section_personal', type: 'TEXT', content: '## Personal' }),
		]);
		assert.deepStrictEqual(
			fields.map(field => field.id),
			[undefined, undefined],
		);
	});

	test('two compilations of the same field names mint different ids', () => {
		const once = compileTypedFields([
			parseTyped({ name: 'a', type: 'TEXT_INPUT' }),
			parseTyped({
				name: 'b',
				type: 'SELECT',
				dynamicOptions: { workflowId: 'wf', inputFromFields: { x: 'a' } },
			}),
		]);
		const twice = compileTypedFields([
			parseTyped({ name: 'a', type: 'TEXT_INPUT' }),
			parseTyped({
				name: 'b',
				type: 'SELECT',
				dynamicOptions: { workflowId: 'wf', inputFromFields: { x: 'a' } },
			}),
		]);
		assert.notStrictEqual(
			once.fields[0].id,
			twice.fields[0].id,
			'ids are unique across forms, not derived from names',
		);
	});

	test('a caller-supplied field id that is not a UUID is rejected with what to do instead', () => {
		const report = validateFormFields([
			{ id: 'field_first_name', type: 'TEXT_INPUT', schema: { name: 'first_name' } },
		]);
		assert.strictEqual(report.ok, false);
		assert.deepStrictEqual(codes(report.errors), ['field_id_not_uuid']);
		assert.match(report.errors[0].message, /omit the id to have one assigned/);
		assert.ok(!report.passedChecks.includes('field_ids_are_uuids'));
	});

	test('an explicit UUID from a stored field is kept and reused by references', () => {
		const existing = new Map([['first_name', uuid(7)]]);
		const { fields } = compileTypedFields(
			[
				parseTyped({
					name: 'manager',
					type: 'SELECT',
					dynamicOptions: { workflowId: 'wf', inputFromFields: { name: 'first_name' } },
				}),
			],
			existing,
		);
		const mapping = (
			fields[0].schema as { enumSourceWorkflow: { inputFromFields: Record<string, { fieldId: string }> } }
		).enumSourceWorkflow.inputFromFields.name;
		assert.strictEqual(mapping.fieldId, uuid(7));
	});
});
