export class DomainError extends Error {constructor(message:string,public statusCode=400){super(message)}}
/** Safe wording for a database rejection: constraint names and SQL stay out of
 * the response. Busy and deadlock conditions are 503 so a client retries. */
const SQLSTATE:Record<string,[number,string]>={
 '23505':[409,'Bản ghi hoặc mã đã tồn tại'],
 '23503':[409,'Bản ghi đang được sử dụng trong quy trình'],
 '23514':[409,'Thao tác vi phạm quy tắc dữ liệu của hệ thống'],
 '55P03':[503,'Hệ thống đang bận xử lý chứng từ này; vui lòng thử lại'],
 '40P01':[503,'Hệ thống đang bận; vui lòng thử lại'],
 '40001':[503,'Hệ thống đang bận; vui lòng thử lại'],
};
export function databaseError(error:any):DomainError|undefined {const known=SQLSTATE[error?.code];return known?new DomainError(known[1],known[0]):undefined}
export function requireThat(condition:unknown,message:string,status=400):asserts condition {if(!condition)throw new DomainError(message,status)}
