/**
 * @swagger
 * /api/v1/admin/auth/reauthenticate:
 *   post:
 *     tags: [Admin]
 *     summary: Confirm the password for sensitive actions (step-up)
 *     description: Marks the current session as recently authenticated for 5 minutes. Login also counts as recent authentication. Failed attempts count toward the login lockout for the account's email. Requires the configured portal Origin and CSRF token.
 *     security: [{adminSession: []}]
 *     parameters:
 *       - {$ref: '#/components/parameters/AdminManagementCsrf'}
 *     requestBody: {$ref: '#/components/requestBodies/Reauthenticate'}
 *     responses:
 *       '200': {$ref: '#/components/responses/Reauthenticated'}
 *       '401': {description: Missing or invalid admin session token}
 *       '403': {description: Incorrect password, invalid Origin, or invalid CSRF token}
 *       '422': {description: Request validation failed}
 *       '429': {description: Too many failed attempts for this email, or too many requests from this IP}
 * /api/v1/superadmin/auth/reauthenticate:
 *   post:
 *     tags: [Super Admin]
 *     summary: Confirm the password for sensitive actions (step-up)
 *     description: Marks the current session as recently authenticated for 5 minutes. Required before inviting, changing roles, or deactivating admins once 5 minutes have passed since login. Failed attempts count toward the login lockout for the account's email. Requires the configured portal Origin and CSRF token.
 *     security: [{superAdminSession: []}]
 *     parameters:
 *       - {$ref: '#/components/parameters/AdminManagementCsrf'}
 *     requestBody: {$ref: '#/components/requestBodies/Reauthenticate'}
 *     responses:
 *       '200': {$ref: '#/components/responses/Reauthenticated'}
 *       '401': {description: Missing or invalid super admin session token}
 *       '403': {description: Incorrect password, invalid Origin, or invalid CSRF token}
 *       '422': {description: Request validation failed}
 *       '429': {description: Too many failed attempts for this email, or too many requests from this IP}
 * /api/v1/superadmin/admins:
 *   get:
 *     tags: [Super Admin]
 *     summary: List Admin and Super Admin accounts
 *     description: Includes pending and disabled accounts, newest first, and how many of the two Super Admin slots are in use. A slot is held by an active Super Admin or a pending one with an open, unexpired invitation.
 *     security: [{superAdminSession: []}]
 *     parameters:
 *       - {in: query, name: page, schema: {type: integer, minimum: 1, maximum: 10000, default: 1}}
 *       - {in: query, name: limit, schema: {type: integer, minimum: 1, maximum: 100, default: 10}}
 *       - {in: query, name: role, schema: {type: string, enum: [admin, super_admin]}}
 *       - {in: query, name: status, schema: {type: string, enum: [pending, active, disabled]}}
 *     responses:
 *       '200':
 *         description: Admin accounts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: {const: success}
 *                 data:
 *                   type: object
 *                   properties:
 *                     items: {type: array, items: {$ref: '#/components/schemas/AdminAccountRecord'}}
 *                     total: {type: integer}
 *                     page: {type: integer}
 *                     limit: {type: integer}
 *                     super_admin_slots:
 *                       type: object
 *                       properties:
 *                         used: {type: integer}
 *                         max: {type: integer, const: 2}
 *       '401': {description: Missing or invalid super admin session token}
 *       '422': {description: Invalid pagination or filter}
 * /api/v1/superadmin/admins/{id}/role:
 *   patch:
 *     tags: [Super Admin]
 *     summary: Promote an Admin or demote a Super Admin
 *     description: Sets the account's role. Promotion needs a free Super Admin slot (maximum 2, pending invitations included). Demotion requires another active Super Admin to remain. You cannot change your own role. Only active accounts can change role. All of the target's sessions are revoked, so the change applies immediately. Every attempt is audited as admin.role.change. Requires recent authentication (see auth/reauthenticate), the configured portal Origin, and the CSRF token.
 *     security: [{superAdminSession: []}]
 *     parameters:
 *       - {$ref: '#/components/parameters/AdminAccountId'}
 *       - {$ref: '#/components/parameters/AdminManagementCsrf'}
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [role]
 *             properties:
 *               role: {type: string, enum: [admin, super_admin]}
 *           examples:
 *             promote: {summary: Promote to Super Admin, value: {role: super_admin}}
 *             demote: {summary: Demote to Admin, value: {role: admin}}
 *     responses:
 *       '200': {$ref: '#/components/responses/AdminAccountChanged'}
 *       '401': {description: Missing or invalid super admin session token}
 *       '403': {description: Own account, recent authentication required, invalid Origin, or invalid CSRF token}
 *       '404': {description: Admin account not found}
 *       '409': {description: Already in that role, account not active, Super Admin limit reached, or last active Super Admin}
 *       '422': {description: Invalid UUID or role}
 * /api/v1/superadmin/admins/{id}/status:
 *   patch:
 *     tags: [Super Admin]
 *     summary: Deactivate an Admin or Super Admin account
 *     description: Disables the account, revokes all its sessions and any open setup invitation, and frees its Super Admin slot. History and references are preserved; nothing is deleted. You cannot deactivate your own account, and at least one active Super Admin must remain. Reactivation is not available yet, so only "disabled" is accepted. Every attempt is audited as admin.deactivate. Requires recent authentication (see auth/reauthenticate), the configured portal Origin, and the CSRF token.
 *     security: [{superAdminSession: []}]
 *     parameters:
 *       - {$ref: '#/components/parameters/AdminAccountId'}
 *       - {$ref: '#/components/parameters/AdminManagementCsrf'}
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [status]
 *             properties:
 *               status: {type: string, enum: [disabled]}
 *           example: {status: disabled}
 *     responses:
 *       '200': {$ref: '#/components/responses/AdminAccountChanged'}
 *       '401': {description: Missing or invalid super admin session token}
 *       '403': {description: Own account, recent authentication required, invalid Origin, or invalid CSRF token}
 *       '404': {description: Admin account not found}
 *       '409': {description: Already disabled, or last active Super Admin}
 *       '422': {description: Invalid UUID or status (reactivation is not available yet)}
 * components:
 *   parameters:
 *     AdminAccountId:
 *       in: path
 *       name: id
 *       required: true
 *       schema: {type: string, format: uuid}
 *       description: Admin account ID (the id field from admins or auth/me), not the user ID
 *     AdminManagementCsrf:
 *       in: header
 *       name: x-admin-csrf
 *       required: true
 *       schema: {type: string}
 *       description: CSRF token returned by the corresponding portal's login or auth/me
 *   schemas:
 *     AdminAccountRecord:
 *       allOf:
 *         - {$ref: '#/components/schemas/AdminIdentity'}
 *         - type: object
 *           properties:
 *             status: {type: string, enum: [pending, active, disabled]}
 *             last_login_at: {type: [string, 'null'], format: date-time}
 *             created_at: {type: string, format: date-time}
 *   requestBodies:
 *     Reauthenticate:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [password]
 *             properties:
 *               password: {type: string, minLength: 1, maxLength: 128}
 *   responses:
 *     Reauthenticated:
 *       description: Session marked as recently authenticated
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: {const: success}
 *               data:
 *                 type: object
 *                 properties:
 *                   reauthenticated_until: {type: string, format: date-time}
 *     AdminAccountChanged:
 *       description: Account changed and audited
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: {const: success}
 *               data: {$ref: '#/components/schemas/AdminAccountRecord'}
 */
export {};
