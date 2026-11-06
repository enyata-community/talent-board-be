/**
 * @swagger
 * /api/v1/admin/users/{id}/status:
 *   patch:
 *     tags: [Admin]
 *     summary: Suspend or reactivate a Talent or Recruiter account
 *     description: Sets the account to the requested status; it never toggles, so a retried or concurrent request cannot reverse an earlier one. Suspending requires a reason (fetch the options from users/suspension-reasons), atomically revokes refresh sessions and existing access tokens, and hides the account from marketplace discovery and messaging. Reactivating restores access eligibility and requires a fresh login; tokens revoked by suspension stay invalid. Every attempt is audited as user.suspend or user.reactivate, including failed and denied ones. Requires an active Admin session, the configured portal Origin, and its CSRF token.
 *     security: [{adminSession: []}]
 *     parameters:
 *       - {$ref: '#/components/parameters/ManagedUserId'}
 *       - {$ref: '#/components/parameters/AccountStatusCsrf'}
 *     requestBody: {$ref: '#/components/requestBodies/ChangeAccountStatus'}
 *     responses:
 *       '200': {$ref: '#/components/responses/AccountStatusChanged'}
 *       '401': {description: Admin session required}
 *       '403': {description: Invalid Origin or CSRF token}
 *       '404': {description: Marketplace account not found or deleted; internal accounts cannot be targeted}
 *       '409': {description: Account is already in the requested status}
 *       '422': {description: Invalid UUID, status, reason or note; OTHER requires a note}
 * /api/v1/admin/users/suspension-reasons:
 *   get:
 *     tags: [Admin]
 *     summary: List suspension reasons for the portal dropdown
 *     security: [{adminSession: []}]
 *     responses:
 *       '200': {$ref: '#/components/responses/SuspensionReasons'}
 *       '401': {description: Admin session required}
 * /api/v1/superadmin/users/{id}/status:
 *   patch:
 *     tags: [Super Admin]
 *     summary: Suspend or reactivate a Talent or Recruiter account
 *     description: Sets the account to the requested status; it never toggles, so a retried or concurrent request cannot reverse an earlier one. Suspending requires a reason (fetch the options from users/suspension-reasons), atomically revokes refresh sessions and existing access tokens, and hides the account from marketplace discovery and messaging. Reactivating restores access eligibility and requires a fresh login; tokens revoked by suspension stay invalid. Every attempt is audited as user.suspend or user.reactivate, including failed and denied ones. Requires an active Super Admin session, the configured portal Origin, and its CSRF token.
 *     security: [{superAdminSession: []}]
 *     parameters:
 *       - {$ref: '#/components/parameters/ManagedUserId'}
 *       - {$ref: '#/components/parameters/AccountStatusCsrf'}
 *     requestBody: {$ref: '#/components/requestBodies/ChangeAccountStatus'}
 *     responses:
 *       '200': {$ref: '#/components/responses/AccountStatusChanged'}
 *       '401': {description: Super Admin session required}
 *       '403': {description: Invalid Origin or CSRF token}
 *       '404': {description: Marketplace account not found or deleted; internal accounts cannot be targeted}
 *       '409': {description: Account is already in the requested status}
 *       '422': {description: Invalid UUID, status, reason or note; OTHER requires a note}
 * /api/v1/superadmin/users/suspension-reasons:
 *   get:
 *     tags: [Super Admin]
 *     summary: List suspension reasons for the portal dropdown
 *     security: [{superAdminSession: []}]
 *     responses:
 *       '200': {$ref: '#/components/responses/SuspensionReasons'}
 *       '401': {description: Super Admin session required}
 * components:
 *   parameters:
 *     AccountStatusCsrf:
 *       in: header
 *       name: x-admin-csrf
 *       required: true
 *       schema: {type: string}
 *       description: CSRF token returned by the corresponding realm login or auth/me endpoint
 *   schemas:
 *     SuspensionReason:
 *       type: string
 *       enum: [POLICY_VIOLATION, FRAUDULENT_PROFILE, USER_REQUEST, OTHER]
 *   requestBodies:
 *     ChangeAccountStatus:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 title: Suspend
 *                 additionalProperties: false
 *                 required: [status, reason]
 *                 properties:
 *                   status: {type: string, enum: [suspended]}
 *                   reason: {$ref: '#/components/schemas/SuspensionReason'}
 *                   note: {type: string, minLength: 1, maxLength: 1000, description: Required when reason is OTHER; whitespace is trimmed}
 *               - type: object
 *                 title: Reactivate
 *                 additionalProperties: false
 *                 required: [status]
 *                 properties:
 *                   status: {type: string, enum: [active]}
 *                   note: {type: string, minLength: 1, maxLength: 1000}
 *             discriminator: {propertyName: status}
 *           examples:
 *             suspend_policy_violation:
 *               summary: Suspend - Policy violation
 *               value: {status: suspended, reason: POLICY_VIOLATION, note: Confirmed policy violation after review}
 *             suspend_fraudulent_profile:
 *               summary: Suspend - Fraudulent profile
 *               value: {status: suspended, reason: FRAUDULENT_PROFILE}
 *             suspend_user_request:
 *               summary: Suspend - User request
 *               value: {status: suspended, reason: USER_REQUEST}
 *             suspend_other:
 *               summary: Suspend - Other (note required)
 *               value: {status: suspended, reason: OTHER, note: Describe why the account is suspended}
 *             reactivate:
 *               summary: Reactivate
 *               value: {status: active, note: Review completed; account restored}
 *   responses:
 *     SuspensionReasons:
 *       description: Suspension reasons with display labels
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: {const: success}
 *               data:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     value: {$ref: '#/components/schemas/SuspensionReason'}
 *                     label: {type: string}
 *                     note_required: {type: boolean, description: Present and true when a note must be supplied}
 *           example:
 *             status: success
 *             data:
 *               - {value: POLICY_VIOLATION, label: Policy violation}
 *               - {value: FRAUDULENT_PROFILE, label: Fraudulent profile}
 *               - {value: USER_REQUEST, label: User request}
 *               - {value: OTHER, label: Other, note_required: true}
 *     AccountStatusChanged:
 *       description: Account status changed and audited
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: {const: success}
 *               data:
 *                 type: object
 *                 properties:
 *                   id: {type: string, format: uuid}
 *                   account_type: {type: string, enum: [talent, recruiter]}
 *                   status: {type: string, enum: [active, suspended]}
 *                   suspension_reason: {oneOf: [{$ref: '#/components/schemas/SuspensionReason'}, {type: 'null'}]}
 *                   suspension_note: {type: [string, 'null']}
 *                   suspended_at: {type: [string, 'null'], format: date-time}
 *                   suspended_by: {type: [string, 'null'], format: uuid, description: Admin account ID}
 */
export {};
