/** Normalize common paste formats without storing or echoing the secret. */
export function parseGeminiKeys(inputs:string[]):string[]{
 const wrappers=/^[\[\]'"`]+|[\[\]'"`]+$/g;
 const keys=inputs.flatMap(input=>input.split(/[,;\r\n]+/)).map(part=>part.trim().replace(wrappers,'').trim().replace(/^GEMINI_API_KEYS?\s*=\s*/i,'').trim().replace(wrappers,'').trim()).filter(Boolean);
 if(keys.length<1||keys.length>20)throw new Error('Nhập từ 1 đến 20 Gemini API key.');
 if(keys.some(key=>key.length>512||!/^[\x21-\x7e]+$/.test(key)))throw new Error('Key có ký tự không hợp lệ. Hãy dán giá trị key hoặc danh sách key ngăn bằng dấu phẩy.');
 return [...new Set(keys)];
}
