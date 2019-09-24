import moment from 'moment'

/** 
 * Validates a field according to its type.
 * @returns empty array if no errors, or array with text describing each issue
*/
function validate(value, field) {
	switch (field.type) {
		case 'quantitative': return validateQuantitative(value, field)
		case 'qualitative': return validateQualitative(value, field)
		case 'date': return validateDate(value, field)
		case 'datetime': return validateDateTime(value, field)
		case 'time': return validateTime(value, field)
		case 'text': return validateText(value, field)
		case 'icd10': return validateICD10(value, field)
		default: // none
			return []
	}
}

/** 
 * Validates a qualitative value to be within the range 
 * dictated by the fields valid_values first and second elements.
 * 
 * Assumes 'unknown' if value is larger or equal to field.unknown
 * 
 * @returns empty array if no errors, or array with text describing each issue
 */
function validateQuantitative(value, field) {
	if (!field.valid_values)
		return []

	if (value.toString() === field.unknown || parseInt(value) >= parseInt(field.unknown))
		return []

	let v = parseInt(value)
	
	if (v.toString() === 'NaN')
		return [`Not a number`]

	let range = field.valid_values.split(',').map(d => parseFloat(d))

	return (v >= range[0] && v <= range[1]) ? [] : [`'${value}' is not in range ${range[0]} .. ${range[1]}`]
}

/** 
 * Validates a qualitative value to exist within the fields valid_values.
 * @returns empty array if no errors, or array with text describing each issue
 */
function validateQualitative(value, field) {
	if (!field.valid_values)
		return []

	if (value.toString() === field.unknown || value.toString() === 'NaN')
		return []

	return field.valid_values.split(',').indexOf(value.toString()) !== -1 ? [] : [`'${value}' is not a valid value`]
}

/** 
 * Validates a date to match YYYY-HH-MM and be a valid date.
 * @returns empty array if no errors, or array with text describing each issue
 */
function validateDate(value, field) {
	if (value === field.unknown)
		return [];

	// Check format
	if (!(/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/.test(value)))
		return [`'${value}' is not in correct format YYYY-MM-DD`]

	// Validate date with moment
	return moment(value).isValid() ? [] : [`'${value}' is not in a valid date`]
}

/** 
 * Validates a date and time to match format YYYY-MM-DD HH:mm and be a valid date.
 * @returns empty array if no errors, or array with text describing each issue
 */
function validateDateTime(value, field) {
	if (value === field.unknown)
		return [];

	// Check format
	if (!(/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]$/.test(value)))
		return [`'${value}' is not in correct format YYYY-MM-DD HH:mm`]

	// Validate date and time with moment
	return moment(value).isValid() ? [] : [`'${value}' is not a valid date or time`]
}

/** 
 * Validates a time string to match HH:mm and be in range.
 * @returns empty array if no errors, or array with text describing each issue
 */
function validateTime(value, field) {
	if (value === field.unknown)
		return [];

	// Check format
	if (!(/^[0-9][0-9]:[0-9][0-9]$/.test(value)))
		return [`'${value}' is in correct format HH:mm`]

	// Check ranges
	let tok = value.split(':')
	let h = parseInt(tok[0])
	let m = parseInt(tok[1])

	return h >= 0 && h < 24 && m >= 0 && m < 60 ? [] : [`'${value}' is not a valid time`]
}

/** 
 * Validates a text to be shorter than 1000 characters.
 * @returns empty array if no errors, or array with text describing each issue
 */
function validateText(value, field) {
	if (value === field.unknown)
		return [];

	return value !== undefined && value.length <= 1000 ? [] : ['Text too long (< 1000 characters)']
}
/** 
 * Validates an icd10 code to be one of the valid values
 * @returns empty array if no errors, or array with text describing each issue
 */
function validateICD10(value, field) {
	if (value === field.unknown)
		return [];

	return value !== undefined && field.valid_values.split(',').indexOf(value) !== -1 ? [] : ['Unknown ICD10 code']
}

/** 
 * Generates a validation result for a whole record, 
 * using calculated fields and logic_checks.
 * @returns array of validation result for each field
 */
function validateRecord(record, fields) {
	var result = {}
	var context = {}

	// Apply non calculated fields to context
	for (let field of fields) {
		if (field.calculated !== 'yes') {
			switch (field.type) {
				case 'qualitative':
				case 'quantitative':
					context[field.name] = parseInt(record[field.name])
					break;
				case 'icd10':
					context[field.name] = (record[field.name] || '').toString()
					break;
				default:
					context[field.name] = record[field.name]
			}
		}
	}

	// Setup calculated context
	for (let field of fields) {
		if (field.calculated === 'yes') {
			let func = new Function('return ' + thisVars(field.equation)).bind(context)
			Object.defineProperty(
				context,
				field.name,
				{
					get() { return func() }
				}
			)
		}
	}

	// Apply calculated context to result and do logic checks
	for (let field of fields) {
		var logicErrors = validate(context[field.name], field) || []
		var logicWarnings = []
		
		if (field.logic_checks) {
			var checks = checkLogic(field, context)
			var logicPrompts = JSON.parse('[' + field.logic_prompts + ']')
			var mustBeTrue = field.logic_must_be_true.split(',').map(d => d.trim() === 'yes')
			
			for (let i in checks) {
				if (typeof checks[i] === 'string')
					logicErrors.push('"' + (fields.find(d => d.name == checks[i]) || {}).label + '" can not be empty')
				else if (checks[i] && mustBeTrue[i] === true)
					logicErrors.push(logicPrompts[i])
				else if (checks[i] && !mustBeTrue[i])
					logicWarnings.push(logicPrompts[i])
			}
		}

		result[field.name] = {
			value: context[field.name],
			valid: logicErrors.length === 0,
			errors: logicErrors,
			warnings: logicWarnings,
			unknown: (context[field.name] || '').toString() === field.unknown && field.unknown !== '',
			incomplete: !context[field.name] && context[field.name] !== 0,
			type: field.type
		}
	}

	return result
}

var findVarRegex = /([a-z_]+)/g
function thisVars(text) {
	return text.replace(findVarRegex, 'this.$1')
}

/**
 * Checks field logic against context
 * Returns an array of results from logic checks
 * Elements can be true(an error), false(no error) or a string with a field name
 * signaling that a dependent value were undefined (an error).
 */
function checkLogic(field, context) {
	return field.logic_checks.split(',')
		.map(c => {
			// If any of the dependent values are _undefined_ test failure
			// If any of the dependent values are _unknown_ test succeeds 
			var vars = c.trim().match(findVarRegex)
			
			for (let v of vars)
				// Check if a field dependency 
				if (context[v] === undefined || context[v] === '')
					return v // Dependent value is _undefined_ so return the undefined field id for error message
				else if (context[v] == field.unknown)
					return false // Dependent value is _unknown_ pass test

			// Run the test
			var func = new Function('return ' + thisVars(c.trim()))
				.bind(context)()
			return func
		})
}


export default validate
export {
	validateQualitative,
	validateQuantitative,
	validateDate,
	validateDateTime,
	validateText,
	validateICD10,
	validateRecord,
}