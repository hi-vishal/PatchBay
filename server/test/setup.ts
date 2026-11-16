// Fixed values for tests only. The env module skips the root .env when NODE_ENV=test,
// so real credentials on a developer machine never reach a test run.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unused-in-tests';
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.CORS_ORIGINS = 'http://allowed.test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
