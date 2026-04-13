const candidateService = require('../services/candidateService');

/**
 * Get candidates assigned to a specific position
 * GET /admins/positions/:positionId/candidates
 */
exports.getCandidatesByPosition = async (req, res, next) => {
    try {
        const { positionId } = req.params;
        const { limit = 5, offset = 0 } = req.query;

        if (!positionId) {
            return res.status(400).json({
                success: false,
                message: 'Position ID is required'
            });
        }

        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await candidateService.getCandidatesByPosition(
            req.tenantDb,
            positionId,
            limit,
            offset,
            userId,
            req.user?.dataFilter
        );

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.getAcademicMetadata = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organizationId;
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organization_id is required' });
        }
        const result = await candidateService.getAcademicMetadata(req.tenantDb, organizationId);
        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.getCandidatesForBulkEmail = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organizationId;
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organization_id is required' });
        }
        const filters = {
            dept_id: req.query.dept_id,
            branch_id: req.query.branch_id,
            semester: req.query.semester,
            search: req.query.search,
            limit: req.query.limit,
            offset: req.query.offset
        };
        const result = await candidateService.getCandidatesForBulkEmail(req.tenantDb, organizationId, filters);
        return res.status(200).json({
            success: true,
            data: result.data || [],
            total: result.total || 0
        });
    } catch (error) {
        next(error);
    }
};

exports.sendBulkEmail = async (req, res, next) => {
    try {
        const { recipients, subject, body, cc, templateName } = req.body;
        if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ success: false, message: 'Recipients array is required' });
        }
        if (!subject || !body) {
            return res.status(400).json({ success: false, message: 'Subject and Email Body are required' });
        }
        
        const ActivityLogService = require('../services/activityLogService');
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.body.organizationId;
        
        // Resolve variables for activity title
        let resolvedTitle = subject.replace(/{company_name}/gi, recipients[0]?.company_name || 'Organization');
        
        if (recipients.length === 1) {
            resolvedTitle = resolvedTitle.replace(/{candidate_name}/gi, recipients[0].name || recipients[0].candidate_name || '');
        } else {
            resolvedTitle = `Mass Email: ${resolvedTitle}`;
        }

        const resolvedDescription = recipients.length === 1
            ? `Sending email to ${recipients[0].name || recipients[0].candidate_name}.`
            : `Sending bulk email to ${recipients.length} recipients.`;

        // 1. Log the mass email activity as PENDING
        const activityId = await ActivityLogService.logActivity(req.tenantDb, {
            organizationId,
            actorId: req.user?.id || req.headers['x-user-id'],
            actorName: req.user?.name || req.user?.fullName || 'Admin',
            actorRole: req.user?.role || 'ADMIN',
            activityType: 'MASS_EMAIL',
            activityTitle: resolvedTitle,
            activityDescription: resolvedDescription,
            metadata: {
                total: recipients.length,
                sent: 0,
                failed: 0,
                pending: recipients.length,
                status: 'PENDING',
                errors: [],
                templateName: templateName || 'Standard Template',
                templateId: req.body.templateId || null,
                recipient: recipients.length === 1 ? recipients[0].email : null,
                candidateName: recipients.length === 1 ? (recipients[0].name || recipients[0].candidate_name) : null,
                candidateId: recipients.length === 1 ? recipients[0].id : null,
                positionName: recipients[0]?.position_title || '',
                positionId: recipients[0]?.position_id || null,
                subject: subject
            }
        });

        // 2. Start background processing (do NOT await)
        candidateService.sendBulkEmail(
            req.tenantDb,
            organizationId,
            recipients,
            subject,
            body,
            cc,
            templateName || 'Standard Template',
            activityId
        ).catch(err => {
            console.error('[Background Email Process Error]:', err);
        });

        return res.status(200).json({
            success: true,
            message: 'Mass email process started in background. Check Inbox for progress.',
            data: { activityId }
        });
    } catch (error) {
        next(error);
    }
};

exports.getBulkEmailFailures = async (req, res, next) => {
    try {
        const { mongoId } = req.params;
        if (!mongoId) {
            return res.status(400).json({ success: false, message: 'Mongo ID is required' });
        }

        const mongo = require('../config/mongo');
        const db = await mongo.getDb();
        const { ObjectId } = require('mongodb');
        
        const failure = await db.collection('email_log_failures').findOne({ _id: new ObjectId(mongoId) });
        
        if (!failure) {
            return res.status(404).json({ success: false, message: 'Failure log not found or expired (72h limit)' });
        }

        res.json({ success: true, data: failure });
    } catch (error) {
        console.error('Error fetching email failures:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getUniqueBatches = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organizationId;
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organization_id is required' });
        }
        const result = await candidateService.getUniqueBatches(organizationId);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

exports.resendInvitation = async (req, res, next) => {
    try {
        const { id } = req.params;
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organizationId;
        
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organization_id is required' });
        }

        const result = await candidateService.resendInvitation(id, organizationId, req.tenantDb);
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

exports.removeCandidateFromPosition = async (req, res, next) => {
    try {
        const { id, positionId } = req.params;
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organizationId;

        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organization_id is required' });
        }

        if (!positionId) {
            return res.status(400).json({ success: false, message: 'positionId is required' });
        }

        const result = await candidateService.removeCandidateFromPosition(id, positionId, organizationId, req.tenantDb);
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

exports.getAssessmentSummaries = async (req, res, next) => {
    try {
        const { candidateId, positionId } = req.query;
        if (!candidateId || !positionId) {
            return res.status(400).json({ success: false, message: 'candidateId and positionId are required' });
        }
        const result = await candidateService.getAssessmentSummary(candidateId, positionId, req.tenantDb);
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

exports.getCandidateCredits = async (req, res, next) => {
    try {
        const { id: candidateId } = req.params;
        if (!candidateId) {
            return res.status(400).json({ success: false, message: 'Candidate ID is required' });
        }
        const result = await candidateService.getCandidateCreditsOverview(candidateId);
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};
