const config = require('../config');

module.exports = {
  openapi: '3.0.0',
  info: {
    title: 'KareerGrowth Admin Backend API',
    version: '1.0.0',
    description: 'Admin Backend Service for managing client databases, credits, and admin operations',
    contact: {
      name: 'KareerGrowth Team',
      email: 'support@kareergrowth.com'
    }
  },
  servers: [
    {
      url: process.env.SWAGGER_SERVER_URL,
      description: 'API server'
    }
  ],
  tags: [
    { name: 'Admin Management', description: 'Admin user and database management' },
    { name: 'Health', description: 'Service health checks' }
  ],
  components: {
    securitySchemes: {
      serviceToken: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Service-Token',
        description: 'Internal service authentication token'
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token for authenticated requests'
      }
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          data: { type: 'object' }
        }
      },
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Error message' },
          error: { type: 'string', example: 'ERROR_CODE' }
        }
      },
      AdminCreateRequest: {
        type: 'object',
        required: ['email', 'password', 'clientName', 'totalInterviewCredits', 'totalPositionCredits', 'validTill'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'admin@company.com',
            description: 'Admin user email address'
          },
          password: {
            type: 'string',
            minLength: 8,
            example: 'SecurePass123!',
            description: 'Admin password (min 8 characters)'
          },
          firstName: {
            type: 'string',
            example: 'John',
            description: 'Admin first name'
          },
          lastName: {
            type: 'string',
            example: 'Doe',
            description: 'Admin last name'
          },
          phoneNumber: {
            type: 'string',
            example: '+1-555-0100',
            description: 'Admin phone number'
          },
          clientName: {
            type: 'string',
            example: 'AcmeCorp',
            description: 'Client company name (used to generate unique database)'
          },
          totalInterviewCredits: {
            type: 'integer',
            example: 100,
            description: 'Total interview credits allocated'
          },
          totalPositionCredits: {
            type: 'integer',
            example: 50,
            description: 'Total position credits allocated'
          },
          validTill: {
            type: 'string',
            format: 'date',
            example: '2027-12-31',
            description: 'Credits validity date (YYYY-MM-DD)'
          },
          roleId: {
            type: 'string',
            format: 'uuid',
            example: '76267ca0-69a9-4d0d-968b-df1449800629',
            description: 'Role ID (UUID) - determines admin type: ADMIN role = College, ATS role = Recruiter'
          }
        }
      },
      AdminCreateResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Admin user created successfully' },
          data: {
            type: 'object',
            properties: {
              userId: {
                type: 'string',
                format: 'uuid',
                example: '042ff635-2c76-43ca-8a56-68ca0b3727e6',
                description: 'Created admin user ID'
              },
              email: {
                type: 'string',
                format: 'email',
                example: 'admin@acmecorp.com'
              },
              firstName: {
                type: 'string',
                example: 'Sarah'
              },
              lastName: {
                type: 'string',
                example: 'Johnson'
              },
              schemaName: {
                type: 'string',
                example: 'acmecorp_mlvtnpkp',
                description: 'Generated database name for client'
              },
              clientName: {
                type: 'string',
                example: 'AcmeCorp'
              },
              credits: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                    example: '0442b009-6092-427c-9ed8-07195a4660a1'
                  },
                  totalInterviewCredits: { type: 'integer', example: 150 },
                  totalPositionCredits: { type: 'integer', example: 75 },
                  validTill: { type: 'string', format: 'date', example: '2027-12-31' },
                  isActive: { type: 'boolean', example: true }
                }
              }
            }
          }
        }
      },
      HealthResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Service is healthy' },
          data: {
            type: 'object',
            properties: {
              service: { type: 'string', example: 'AdminBackend' },
              status: { type: 'string', example: 'healthy' },
              timestamp: { type: 'string', format: 'date-time' },
              uptime: { type: 'number', example: 3600.5 },
              database: { type: 'string', example: 'connected' }
            }
          }
        }
      }
    }
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check endpoint',
        description: 'Returns the health status of the Admin Backend service',
        responses: {
          200: {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' }
              }
            }
          }
        }
      }
    },
    '/admins/create': {
      post: {
        tags: ['Admin Management'],
        summary: 'Create new admin user with client database',
        description: `Creates a new admin user in auth_db and generates a dedicated client database with full schema and credits table. 
        
**Process:**
1. Validates email uniqueness in auth_db.users
2. Generates unique database name from clientName
3. Creates admin user record in auth_db.users with client field
4. Creates new MySQL database for the client
5. Initializes database with full admin schema (13 tables)
6. Inserts credits record with is_active=true
        
**Note:** Only credits with is_active=true are shown in UI.`,
        security: [{ serviceToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AdminCreateRequest' },
              examples: {
                basic: {
                  summary: 'Basic admin creation',
                  value: {
                    email: 'admin@acmecorp.com',
                    password: 'SecurePass123!',
                    firstName: 'Sarah',
                    lastName: 'Johnson',
                    phoneNumber: '+1-555-0200',
                    clientName: 'AcmeCorp',
                    totalInterviewCredits: 150,
                    totalPositionCredits: 75,
                    validTill: '2027-12-31'
                  }
                },
                enterprise: {
                  summary: 'Enterprise admin creation',
                  value: {
                    email: 'admin@globaltech.com',
                    password: 'SecurePass123!',
                    firstName: 'Michael',
                    lastName: 'Chen',
                    clientName: 'GlobalTech',
                    totalInterviewCredits: 500,
                    totalPositionCredits: 250,
                    validTill: '2028-12-31'
                  }
                }
              }
            }
          }
        },
        responses: {
          201: {
            description: 'Admin user created successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminCreateResponse' }
              }
            }
          },
          400: {
            description: 'Bad request - Missing required fields or validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                examples: {
                  missingFields: {
                    summary: 'Missing required fields',
                    value: {
                      success: false,
                      message: 'Missing required fields: email, password, clientName'
                    }
                  },
                  emailExists: {
                    summary: 'Email already exists',
                    value: {
                      success: false,
                      message: 'Email already exists'
                    }
                  }
                }
              }
            }
          },
          401: {
            description: 'Unauthorized - Invalid or missing service token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: {
                  success: false,
                  message: 'Unauthorized'
                }
              }
            }
          },
          500: {
            description: 'Internal server error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: {
                  success: false,
                  message: 'Failed to create admin user'
                }
              }
            }
          }
        }
      }
    }
  }
};
