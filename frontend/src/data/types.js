/** Thrown by data layer for expected, user-facing failures. */
export class DataError extends Error {
    code;
    detail;
    constructor(code, message, detail) {
        super(message);
        this.name = "DataError";
        this.code = code;
        this.detail = detail;
    }
}
export function isDataError(error) {
    return error instanceof DataError;
}
