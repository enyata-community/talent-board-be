/**
 * @swagger
 * /api/v1/talents/{id}/resume:
 *   get:
 *     summary: Download a résumé
 *     description: Available to the talent owner and authenticated recruiters. Recruiters can download only completed, approved talent profiles. Storage keys and provider URLs are never returned.
 *     tags: [Talents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Private PDF attachment with Cache-Control no-store.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: User is neither the owner nor a recruiter.
 *       404:
 *         description: Résumé or eligible profile not found.
 *       422:
 *         description: Invalid talent UUID.
 *       503:
 *         description: S3 is not configured or is unavailable.
 * /api/v1/assets/avatars/{filename}:
 *   get:
 *     summary: Retrieve a public avatar
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: JPEG, PNG, or WebP with content type detected from file bytes.
 *       404:
 *         description: Avatar not found or invalid file reference.
 */
export {};
