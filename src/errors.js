// Error type for clean, user-facing API failures.
// Handlers return { error } with this status instead of leaking stack traces
// or raw upstream responses to the browser.
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

module.exports = { ApiError };
