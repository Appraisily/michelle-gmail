/**
 * @typedef {Object} AppraisalFilters
 * @property {string} [email] - Filter by customer email
 * @property {string} [sessionId] - Filter by session ID
 * @property {string} [wordpressSlug] - Filter by WordPress URL slug
 */

/**
 * @typedef {Object} SaleFilters
 * @property {string} [email] - Filter by customer email
 * @property {string} [sessionId] - Filter by session ID
 * @property {string} [stripeCustomerId] - Filter by Stripe customer ID
 */

/**
 * @typedef {Object} Appraisal
 * @property {string} date - Appraisal date
 * @property {string} serviceType - Type of service
 * @property {string} sessionId - Unique session identifier
 * @property {string} customerEmail - Customer's email address
 * @property {string} customerName - Customer's name
 * @property {string} appraisalStatus - Current status
 * @property {string} appraisalEditLink - Edit link URL
 * @property {string} imageDescription - AI-generated image description
 * @property {string} customerDescription - Customer's description
 * @property {string} appraisalValue - Appraised value
 * @property {string} appraisersDescription - Appraiser's description
 * @property {string} finalDescription - Final description
 * @property {string} pdfLink - PDF report link
 * @property {string} docLink - Document link
 * @property {string} imagesJson - JSON string of image data
 * @property {string} wordpressSlug - WordPress URL slug
 */

/**
 * @typedef {Object} Sale
 * @property {string} sessionId - Unique session identifier
 * @property {string} chargeId - Stripe charge ID
 * @property {string} stripeCustomerId - Stripe customer ID
 * @property {string} customerName - Customer's name
 * @property {string} customerEmail - Customer's email address
 * @property {string} amount - Sale amount
 * @property {string} date - Sale date
 */

/**
 * @typedef {Object} AppraisalResponse
 * @property {Appraisal[]} appraisals - List of appraisals
 * @property {number} total - Total count of appraisals
 */

/**
 * @typedef {Object} SaleResponse
 * @property {Sale[]} sales - List of sales
 * @property {number} total - Total count of sales
 */

export const AppraisalStatus = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed'
};