/**
 * @swagger
 * /api/v1/admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: List Talent and Recruiter accounts
 *     description: Case-insensitive substring search over email and full name. Excludes deleted and internal accounts. Requires the Admin realm session. Read-only; no CSRF header required.
 *     security: [{adminSession: []}]
 *     parameters:
 *       - {$ref: '#/components/parameters/ManagedUsersPage'}
 *       - {$ref: '#/components/parameters/ManagedUsersLimit'}
 *       - {$ref: '#/components/parameters/ManagedUsersSearch'}
 *       - {$ref: '#/components/parameters/ManagedUsersType'}
 *       - {$ref: '#/components/parameters/ManagedUsersStatus'}
 *       - {$ref: '#/components/parameters/ManagedUsersSort'}
 *       - {$ref: '#/components/parameters/ManagedUsersOrder'}
 *     responses:
 *       '200': {$ref: '#/components/responses/ManagedUsersList'}
 *       '401': {description: Missing, expired, disabled, or wrong-realm admin session}
 *       '422': {description: Invalid query parameters}
 * /api/v1/superadmin/users:
 *   get:
 *     tags: [Super Admin]
 *     summary: List Talent and Recruiter accounts
 *     description: Case-insensitive substring search over email and full name. Excludes deleted and internal accounts. Requires the Super Admin realm session. Read-only; no CSRF header required.
 *     security: [{superAdminSession: []}]
 *     parameters:
 *       - {$ref: '#/components/parameters/ManagedUsersPage'}
 *       - {$ref: '#/components/parameters/ManagedUsersLimit'}
 *       - {$ref: '#/components/parameters/ManagedUsersSearch'}
 *       - {$ref: '#/components/parameters/ManagedUsersType'}
 *       - {$ref: '#/components/parameters/ManagedUsersStatus'}
 *       - {$ref: '#/components/parameters/ManagedUsersSort'}
 *       - {$ref: '#/components/parameters/ManagedUsersOrder'}
 *     responses:
 *       '200': {$ref: '#/components/responses/ManagedUsersList'}
 *       '401': {description: Missing, expired, disabled, or wrong-realm admin session}
 *       '422': {description: Invalid query parameters}
 * /api/v1/admin/users/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: Inspect a Talent or Recruiter account
 *     description: Returns account and profile information plus active conversation connections and saved-talent pipeline relationships. Page and limit apply independently to both relationship collections. Deleted accounts and relationships are excluded. Message bodies, passwords, session tokens, and storage keys are omitted. Interview scheduling is unavailable in the current data model. Read-only; no CSRF header required.
 *     security: [{adminSession: []}]
 *     parameters:
 *       - {$ref: '#/components/parameters/ManagedUserId'}
 *       - {$ref: '#/components/parameters/ManagedUsersPage'}
 *       - {$ref: '#/components/parameters/ManagedUsersLimit'}
 *     responses:
 *       '200': {$ref: '#/components/responses/ManagedUserDetail'}
 *       '401': {description: Missing, expired, disabled, or wrong-realm admin session}
 *       '404': {description: Account missing, deleted, or not a Talent/Recruiter}
 *       '422': {description: Invalid UUID or pagination}
 * /api/v1/superadmin/users/{id}:
 *   get:
 *     tags: [Super Admin]
 *     summary: Inspect a Talent or Recruiter account
 *     description: Returns account and profile information plus active conversation connections and saved-talent pipeline relationships. Page and limit apply independently to both relationship collections. Deleted accounts and relationships are excluded. Message bodies, passwords, session tokens, and storage keys are omitted. Interview scheduling is unavailable in the current data model. Read-only; no CSRF header required.
 *     security: [{superAdminSession: []}]
 *     parameters:
 *       - {$ref: '#/components/parameters/ManagedUserId'}
 *       - {$ref: '#/components/parameters/ManagedUsersPage'}
 *       - {$ref: '#/components/parameters/ManagedUsersLimit'}
 *     responses:
 *       '200': {$ref: '#/components/responses/ManagedUserDetail'}
 *       '401': {description: Missing, expired, disabled, or wrong-realm admin session}
 *       '404': {description: Account missing, deleted, or not a Talent/Recruiter}
 *       '422': {description: Invalid UUID or pagination}
 * components:
 *   parameters:
 *     ManagedUserId:
 *       in: path
 *       name: id
 *       required: true
 *       schema: {type: string, format: uuid}
 *     ManagedUsersPage:
 *       in: query
 *       name: page
 *       schema: {type: integer, minimum: 1, maximum: 10000, default: 1}
 *     ManagedUsersLimit:
 *       in: query
 *       name: limit
 *       schema: {type: integer, minimum: 1, maximum: 100, default: 10}
 *     ManagedUsersSearch:
 *       in: query
 *       name: search
 *       description: Full or partial name/email, case-insensitive. SQL wildcard characters are treated literally.
 *       schema: {type: string, minLength: 1, maxLength: 254, example: jane do}
 *     ManagedUsersType:
 *       in: query
 *       name: account_type
 *       schema: {type: string, enum: [talent, recruiter]}
 *     ManagedUsersStatus:
 *       in: query
 *       name: status
 *       description: Account status, independent of talent profile review status. Existing accounts default to active. This module does not change account status.
 *       schema: {type: string, enum: [active, suspended]}
 *     ManagedUsersSort:
 *       in: query
 *       name: sort_by
 *       description: Last activity is recorded on session issuance and authenticated marketplace requests, with writes throttled to once per five minutes. Historical session and messaging activity is backfilled during migration. Unknown activity sorts last in both directions. Ties use account UUID.
 *       schema: {type: string, enum: [join_date, last_activity], default: join_date}
 *     ManagedUsersOrder:
 *       in: query
 *       name: sort_order
 *       schema: {type: string, enum: [asc, desc], default: desc}
 *   responses:
 *     ManagedUsersList:
 *       description: Paginated accounts (Cache-Control no-store)
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: {const: success}
 *               data:
 *                 allOf:
 *                   - {$ref: '#/components/schemas/ManagedUsersPagination'}
 *                   - type: object
 *                     properties:
 *                       items: {type: array, items: {$ref: '#/components/schemas/ManagedUser'}}
 *     ManagedUserDetail:
 *       description: Account details (Cache-Control no-store)
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: {const: success}
 *               data:
 *                 allOf:
 *                   - {$ref: '#/components/schemas/ManagedUser'}
 *                   - type: object
 *                     properties:
 *                       profile:
 *                         description: Null for accounts without an onboarding profile.
 *                         oneOf:
 *                           - {$ref: '#/components/schemas/ManagedTalentProfile'}
 *                           - {$ref: '#/components/schemas/ManagedRecruiterProfile'}
 *                           - {type: 'null'}
 *                       active_connections:
 *                         allOf:
 *                           - {$ref: '#/components/schemas/ManagedUsersPagination'}
 *                           - type: object
 *                             properties:
 *                               items: {type: array, items: {$ref: '#/components/schemas/ManagedConnection'}}
 *                       pipeline_relationships:
 *                         allOf:
 *                           - {$ref: '#/components/schemas/ManagedUsersPagination'}
 *                           - type: object
 *                             properties:
 *                               items: {type: array, items: {$ref: '#/components/schemas/ManagedPipelineRelationship'}}
 *                       interview_scheduling:
 *                         type: object
 *                         properties:
 *                           available: {const: false}
 *                           status: {type: 'null'}
 *   schemas:
 *     ManagedUsersPagination:
 *       type: object
 *       properties:
 *         total: {type: integer, minimum: 0}
 *         page: {type: integer, minimum: 1}
 *         limit: {type: integer, minimum: 1, maximum: 100}
 *     ManagedUserSummary:
 *       type: object
 *       properties:
 *         id: {type: string, format: uuid}
 *         first_name: {type: [string, 'null']}
 *         last_name: {type: [string, 'null']}
 *         email: {type: string, format: email}
 *         account_type: {type: string, enum: [talent, recruiter]}
 *         status: {type: string, enum: [active, suspended]}
 *     ManagedUser:
 *       allOf:
 *         - {$ref: '#/components/schemas/ManagedUserSummary'}
 *         - type: object
 *           properties:
 *             avatar: {type: [string, 'null']}
 *             joined_at: {type: string, format: date-time}
 *             last_activity_at: {type: [string, 'null'], format: date-time}
 *             profile_completed: {type: boolean}
 *             is_email_verified: {type: [boolean, 'null']}
 *             provider: {type: string, enum: [local, google, linkedin]}
 *             state: {type: [string, 'null']}
 *             country: {type: [string, 'null']}
 *             linkedin_profile: {type: [string, 'null']}
 *     ManagedTalentProfile:
 *       type: object
 *       properties:
 *         bio: {type: [string, 'null']}
 *         job_title: {type: string}
 *         experience_level: {type: string, enum: [entry, intermediate, expert]}
 *         profile_status: {type: string, enum: [pending, under_review, approved, rejected]}
 *         portfolio_url: {type: [string, 'null']}
 *         has_resume: {type: boolean}
 *         skills:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id: {type: string, format: uuid}
 *               name: {type: string}
 *     ManagedRecruiterProfile:
 *       type: object
 *       properties:
 *         work_email: {type: string, format: email}
 *         company_industry: {type: string}
 *         roles_looking_for: {type: array, items: {type: string}}
 *         hiring_for: {type: string, enum: [myself, my company]}
 *     ManagedConnection:
 *       type: object
 *       properties:
 *         id: {type: string, format: uuid}
 *         connected_at: {type: string, format: date-time}
 *         latest_message_at: {type: [string, 'null'], format: date-time}
 *         user: {$ref: '#/components/schemas/ManagedUserSummary'}
 *     ManagedPipelineRelationship:
 *       type: object
 *       properties:
 *         id: {type: string, format: uuid}
 *         stage: {const: saved, description: The current pipeline consists of saved talents; no interview stage is persisted.}
 *         saved_at: {type: string, format: date-time}
 *         user: {$ref: '#/components/schemas/ManagedUserSummary'}
 */
export {};
