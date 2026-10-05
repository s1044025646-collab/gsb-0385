// 统一错误码与错误类型
export const ERR = {
  BIT_WIDTH: "E_BIT_WIDTH",
  OPERAND_FORMAT: "E_OPERAND_FORMAT",
  OPERAND_RANGE: "E_OPERAND_RANGE",
  BINARY_FORMAT: "E_BINARY_FORMAT",
  MODE: "E_MODE",
  NOT_FOUND: "E_NOT_FOUND",
  ROUND_RANGE: "E_ROUND_RANGE",
  CANDIDATE_WIDTH: "E_CANDIDATE_WIDTH",
  CANDIDATE_FORMAT: "E_CANDIDATE_FORMAT",
  CANDIDATE_MISMATCH: "E_CANDIDATE_MISMATCH",
  BAD_JSON: "E_BAD_JSON",
  ROUTE: "E_ROUTE",
} as const;

export type ErrorCode = (typeof ERR)[keyof typeof ERR];

export class ApiError extends Error {
  code: ErrorCode;
  details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
