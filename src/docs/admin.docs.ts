/**
 * @swagger
 * /api/v1/admin/auth/login:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Log in to the Admin Portal
 *     security: []
 *     responses:
 *       '200':
 *         description: Success
 *         content: {application/json: {schema: {$ref: '#/components/schemas/AdminAuthResponse'}}}
 *       '400':
 *         description: Invalid or expired invitation
 *       '401':
 *         description: Authentication required or invalid credentials
 *       '403':
 *         description: Origin, CSRF, or role check failed
 *       '409':
 *         description: Conflicting account or invitation state
 *       '422':
 *         description: Request validation failed
 *       '429':
 *         description: Too many attempts; see Retry-After header
 *     parameters: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json: {schema: {type: object, additionalProperties: false, required: [email, password], properties: {email: {type: string, format: email}, password: {type: string, maxLength: 128}}}}
 *     description: >-
 *       Only Admin accounts are accepted. Browsers set Origin automatically. For Postman/curl, send the
 *       configured portal origin.
 * /api/v1/superadmin/auth/login:
 *   post:
 *     tags:
 *       - Super Admin
 *     summary: Log in to the Admin Portal
 *     security: []
 *     responses:
 *       '200':
 *         description: Success
 *         content: {application/json: {schema: {$ref: '#/components/schemas/AdminAuthResponse'}}}
 *       '400':
 *         description: Invalid or expired invitation
 *       '401':
 *         description: Authentication required or invalid credentials
 *       '403':
 *         description: Origin, CSRF, or role check failed
 *       '409':
 *         description: Conflicting account or invitation state
 *       '422':
 *         description: Request validation failed
 *       '429':
 *         description: Too many attempts; see Retry-After header
 *     parameters: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json: {schema: {type: object, additionalProperties: false, required: [email, password], properties: {email: {type: string, format: email}, password: {type: string, maxLength: 128}}}}
 *     description: >-
 *       Only Super Admin accounts are accepted. Browsers set Origin automatically. For Postman/curl, send the
 *       configured portal origin.
 * /api/v1/admin/auth/setup-password:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Consume an invitation and set a password
 *     security: []
 *     responses:
 *       '200':
 *         description: Success
 *         content: {application/json: {schema: {type: object, properties: {status: {const: success}, message: {type: string}}}}}
 *       '400':
 *         description: Invalid or expired invitation
 *       '401':
 *         description: Authentication required or invalid credentials
 *       '403':
 *         description: Origin, CSRF, or role check failed
 *       '409':
 *         description: Conflicting account or invitation state
 *       '422':
 *         description: Request validation failed
 *       '429':
 *         description: Too many attempts; see Retry-After header
 *     parameters: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json: {schema: {type: object, additionalProperties: false, required: [token, password], properties: {token: {type: string, pattern: '^[a-f0-9]{64}$'}, password: {type: string, minLength: 8, maxLength: 128}, display_name: {type: string, maxLength: 100, deprecated: true, description: 'Optional compatibility input, stored as first_name/last_name. Prefer explicit name fields.'}, first_name: {type: string, minLength: 1, maxLength: 50}, last_name: {type: string, minLength: 1, maxLength: 50}}}}
 *     description: >-
 *       Only Admin accounts are accepted. Browsers set Origin automatically. For Postman/curl, send the
 *       configured portal origin.
 * /api/v1/superadmin/auth/setup-password:
 *   post:
 *     tags:
 *       - Super Admin
 *     summary: Consume an invitation and set a password
 *     security: []
 *     responses:
 *       '200':
 *         description: Success
 *         content: {application/json: {schema: {type: object, properties: {status: {const: success}, message: {type: string}}}}}
 *       '400':
 *         description: Invalid or expired invitation
 *       '401':
 *         description: Authentication required or invalid credentials
 *       '403':
 *         description: Origin, CSRF, or role check failed
 *       '409':
 *         description: Conflicting account or invitation state
 *       '422':
 *         description: Request validation failed
 *       '429':
 *         description: Too many attempts; see Retry-After header
 *     parameters: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json: {schema: {type: object, additionalProperties: false, required: [token, password], properties: {token: {type: string, pattern: '^[a-f0-9]{64}$'}, password: {type: string, minLength: 8, maxLength: 128}, display_name: {type: string, maxLength: 100, deprecated: true, description: 'Optional compatibility input, stored as first_name/last_name. Prefer explicit name fields.'}, first_name: {type: string, minLength: 1, maxLength: 50}, last_name: {type: string, minLength: 1, maxLength: 50}}}}
 *     description: >-
 *       Only Super Admin accounts are accepted. Browsers set Origin automatically. For Postman/curl, send the
 *       configured portal origin.
 * /api/v1/admin/auth/logout:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Revoke all account sessions; expired sessions are accepted
 *     security:
 *       - adminSession: []
 *     responses:
 *       '204':
 *         description: Success
 *       '400':
 *         description: Invalid or expired invitation
 *       '401':
 *         description: Authentication required or invalid credentials
 *       '403':
 *         description: Origin, CSRF, or role check failed
 *       '409':
 *         description: Conflicting account or invitation state
 *       '422':
 *         description: Request validation failed
 *       '429':
 *         description: Too many attempts; see Retry-After header
 *     parameters:
 *       - in: header
 *         name: x-admin-csrf
 *         required: true
 *         schema: {type: string}
 *         description: CSRF token returned by login or me; optional only for logout with no valid session
 *     description: >-
 *       Only Admin accounts are accepted. Browsers set Origin automatically. For Postman/curl, send the
 *       configured portal origin.
 * /api/v1/superadmin/auth/logout:
 *   post:
 *     tags:
 *       - Super Admin
 *     summary: Revoke all account sessions; expired sessions are accepted
 *     security:
 *       - superAdminSession: []
 *     responses:
 *       '204':
 *         description: Success
 *       '400':
 *         description: Invalid or expired invitation
 *       '401':
 *         description: Authentication required or invalid credentials
 *       '403':
 *         description: Origin, CSRF, or role check failed
 *       '409':
 *         description: Conflicting account or invitation state
 *       '422':
 *         description: Request validation failed
 *       '429':
 *         description: Too many attempts; see Retry-After header
 *     parameters:
 *       - in: header
 *         name: x-admin-csrf
 *         required: true
 *         schema: {type: string}
 *         description: CSRF token returned by login or me; optional only for logout with no valid session
 *     description: >-
 *       Only Super Admin accounts are accepted. Browsers set Origin automatically. For Postman/curl, send the
 *       configured portal origin.
 * /api/v1/admin/auth/me:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get current admin identity and CSRF token
 *     security:
 *       - adminSession: []
 *     responses:
 *       '200':
 *         description: Success
 *         content: {application/json: {schema: {$ref: '#/components/schemas/AdminAuthResponse'}}}
 *       '400':
 *         description: Invalid or expired invitation
 *       '401':
 *         description: Authentication required or invalid credentials
 *       '403':
 *         description: Origin, CSRF, or role check failed
 *       '409':
 *         description: Conflicting account or invitation state
 *       '422':
 *         description: Request validation failed
 *       '429':
 *         description: Too many attempts; see Retry-After header
 *     description: >-
 *       Only Admin accounts are accepted. Browsers set Origin automatically. For Postman/curl, send the
 *       configured portal origin.
 * /api/v1/superadmin/auth/me:
 *   get:
 *     tags:
 *       - Super Admin
 *     summary: Get current admin identity and CSRF token
 *     security:
 *       - superAdminSession: []
 *     responses:
 *       '200':
 *         description: Success
 *         content: {application/json: {schema: {$ref: '#/components/schemas/AdminAuthResponse'}}}
 *       '400':
 *         description: Invalid or expired invitation
 *       '401':
 *         description: Authentication required or invalid credentials
 *       '403':
 *         description: Origin, CSRF, or role check failed
 *       '409':
 *         description: Conflicting account or invitation state
 *       '422':
 *         description: Request validation failed
 *       '429':
 *         description: Too many attempts; see Retry-After header
 *     description: >-
 *       Only Super Admin accounts are accepted. Browsers set Origin automatically. For Postman/curl, send the
 *       configured portal origin.
 * /api/v1/superadmin/invitations:
 *   post:
 *     tags:
 *       - Super Admin
 *     summary: Invite an Admin (Super Admin only)
 *     security:
 *       - superAdminSession: []
 *     responses:
 *       '201':
 *         description: Success
 *         content: {application/json: {schema: {type: object, properties: {status: {const: success}, data: {$ref: '#/components/schemas/AdminInvitationResult'}}}}}
 *       '400':
 *         description: Invalid or expired invitation
 *       '401':
 *         description: Authentication required or invalid credentials
 *       '403':
 *         description: Origin, CSRF, or role check failed
 *       '409':
 *         description: Conflicting account or invitation state
 *       '422':
 *         description: Request validation failed
 *       '429':
 *         description: Too many attempts; see Retry-After header
 *     parameters:
 *       - in: header
 *         name: x-admin-csrf
 *         required: true
 *         schema: {type: string}
 *         description: CSRF token returned by login or me; optional only for logout with no valid session
 *     requestBody:
 *       required: true
 *       content:
 *         application/json: {schema: {type: object, additionalProperties: false, required: [email], properties: {email: {type: string, format: email}, display_name: {type: string, maxLength: 100, deprecated: true, description: 'Optional compatibility input, stored as first_name/last_name. Prefer explicit name fields.'}, first_name: {type: string, minLength: 1, maxLength: 50}, last_name: {type: string, minLength: 1, maxLength: 50}}}}
 *     description: Browsers set Origin automatically. For Postman/curl, send the configured portal origin.
 *   get:
 *     tags:
 *       - Super Admin
 *     summary: List invitations (Super Admin only)
 *     security:
 *       - superAdminSession: []
 *     responses:
 *       '200':
 *         description: Success
 *         content: {application/json: {schema: {type: object, properties: {status: {const: success}, data: {type: object, properties: {items: {type: array, items: {$ref: '#/components/schemas/AdminInvitationRecord'}}, total: {type: integer}, page: {type: integer}, limit: {type: integer}}}}}}}
 *       '400':
 *         description: Invalid or expired invitation
 *       '401':
 *         description: Authentication required or invalid credentials
 *       '403':
 *         description: Origin, CSRF, or role check failed
 *       '409':
 *         description: Conflicting account or invitation state
 *       '422':
 *         description: Request validation failed
 *       '429':
 *         description: Too many attempts; see Retry-After header
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: {type: integer, minimum: 1, maximum: 10000, default: 1}
 *       - in: query
 *         name: limit
 *         schema: {type: integer, minimum: 1, maximum: 100, default: 10}
 *     description: Browsers set Origin automatically. For Postman/curl, send the configured portal origin.
 * /api/v1/superadmin/invitations/{id}/resend:
 *   post:
 *     tags:
 *       - Super Admin
 *     summary: Rotate and resend a pending invitation (Super Admin only)
 *     security:
 *       - superAdminSession: []
 *     responses:
 *       '200':
 *         description: Success
 *         content: {application/json: {schema: {type: object, properties: {status: {const: success}, data: {$ref: '#/components/schemas/AdminInvitationResult'}}}}}
 *       '400':
 *         description: Invalid or expired invitation
 *       '401':
 *         description: Authentication required or invalid credentials
 *       '403':
 *         description: Origin, CSRF, or role check failed
 *       '409':
 *         description: Conflicting account or invitation state
 *       '422':
 *         description: Request validation failed
 *       '429':
 *         description: Too many attempts; see Retry-After header
 *     parameters:
 *       - in: header
 *         name: x-admin-csrf
 *         required: true
 *         schema: {type: string}
 *         description: CSRF token returned by login or me; optional only for logout with no valid session
 *       - in: path
 *         name: id
 *         required: true
 *         schema: {type: string, format: uuid}
 *     description: Browsers set Origin automatically. For Postman/curl, send the configured portal origin.
 * /api/v1/superadmin/invitations/{id}:
 *   delete:
 *     tags:
 *       - Super Admin
 *     summary: Revoke an invitation (Super Admin only)
 *     security:
 *       - superAdminSession: []
 *     responses:
 *       '204':
 *         description: Success
 *       '400':
 *         description: Invalid or expired invitation
 *       '401':
 *         description: Authentication required or invalid credentials
 *       '403':
 *         description: Origin, CSRF, or role check failed
 *       '409':
 *         description: Conflicting account or invitation state
 *       '422':
 *         description: Request validation failed
 *       '429':
 *         description: Too many attempts; see Retry-After header
 *     parameters:
 *       - in: header
 *         name: x-admin-csrf
 *         required: true
 *         schema: {type: string}
 *         description: CSRF token returned by login or me; optional only for logout with no valid session
 *       - in: path
 *         name: id
 *         required: true
 *         schema: {type: string, format: uuid}
 *     description: Browsers set Origin automatically. For Postman/curl, send the configured portal origin.
 * /api/v1/superadmin/audit-logs:
 *   get:
 *     tags:
 *       - Super Admin
 *     summary: List audit events (Super Admin only)
 *     security:
 *       - superAdminSession: []
 *     responses:
 *       '200':
 *         description: Success
 *         content: {application/json: {schema: {type: object, properties: {status: {const: success}, data: {type: object, properties: {items: {type: array, items: {$ref: '#/components/schemas/AdminAuditRecord'}}, total: {type: integer}, page: {type: integer}, limit: {type: integer}}}}}}}
 *       '400':
 *         description: Invalid or expired invitation
 *       '401':
 *         description: Authentication required or invalid credentials
 *       '403':
 *         description: Origin, CSRF, or role check failed
 *       '409':
 *         description: Conflicting account or invitation state
 *       '422':
 *         description: Request validation failed
 *       '429':
 *         description: Too many attempts; see Retry-After header
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: {type: integer, minimum: 1, maximum: 10000, default: 1}
 *       - in: query
 *         name: limit
 *         schema: {type: integer, minimum: 1, maximum: 100, default: 10}
 *       - in: query
 *         name: actor_id
 *         schema: {type: string}
 *       - in: query
 *         name: action
 *         schema: {type: string}
 *       - in: query
 *         name: outcome
 *         schema: {type: string}
 *       - in: query
 *         name: from
 *         schema: {type: string}
 *       - in: query
 *         name: to
 *         schema: {type: string}
 *     description: Browsers set Origin automatically. For Postman/curl, send the configured portal origin.
 * components:
 *   schemas:
 *     AdminIdentity:
 *       type: object
 *       properties:
 *         id: {type: string, format: uuid}
 *         email: {type: string, format: email}
 *         display_name: {type: string, description: 'Derived from name fields, with email as fallback.'}
 *         role: {type: string, enum: [admin, super_admin]}
 *         user_id: {type: string, format: uuid}
 *         first_name: {type: [string, 'null']}
 *         last_name: {type: [string, 'null']}
 *     AdminAuthResponse:
 *       type: object
 *       properties:
 *         status: {const: success}
 *         data: {type: object, properties: {admin: {$ref: '#/components/schemas/AdminIdentity'}, csrf_token: {type: string}}}
 *     AdminInvitationResult:
 *       type: object
 *       properties:
 *         id: {type: string, format: uuid}
 *         admin_account_id: {type: string, format: uuid}
 *         expires_at: {type: string, format: date-time}
 *         delivery_status: {type: string, enum: [pending, sent, failed]}
 *     AdminInvitationRecord:
 *       type: object
 *       properties:
 *         id: {type: string, format: uuid}
 *         admin_account_id: {type: string, format: uuid}
 *         invited_by_admin_id: {type: [string, 'null'], format: uuid}
 *         expires_at: {type: string, format: date-time}
 *         accepted_at: {type: [string, 'null'], format: date-time}
 *         revoked_at: {type: [string, 'null'], format: date-time}
 *         delivery_status: {type: string}
 *         created_at: {type: string, format: date-time}
 *     AdminAuditRecord:
 *       type: object
 *       properties:
 *         id: {type: [string, 'null']}
 *         actor_id: {type: [string, 'null']}
 *         actor_role: {type: [string, 'null']}
 *         action: {type: [string, 'null']}
 *         outcome: {type: [string, 'null']}
 *         target_id: {type: [string, 'null']}
 *         request_id: {type: [string, 'null']}
 *         ip_address: {type: [string, 'null']}
 *         occurred_at: {type: [string, 'null']}
 */
export {};
