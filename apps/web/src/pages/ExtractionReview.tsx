import { Alert } from 'antd';
import type { Extraction } from '../types';

const names:Record<string,string>={unitPrice:'Đơn giá',quantity:'Số lượng',deliveryDays:'Thời gian giao',qualityScore:'Điểm chất lượng',vat:'VAT',currency:'Tiền tệ',validUntil:'Hạn báo giá'};
function warningText(warning:string){
 const missing=warning.match(/^Missing or invalid field: (.+)$/);
 if(missing)return `Cần bổ sung hoặc sửa: ${names[missing[1]]||missing[1]}.`;
 if(warning.startsWith('Unverified model field ignored:'))return 'Một giá trị do AI đề xuất chưa đối chiếu được với tài liệu nên đã bỏ qua.';
 if(warning.includes('LLM extraction failed'))return 'API AI chưa xử lý thành công; bản nháp hiện được đọc bằng quy tắc.';
 if(warning.includes('Model API rate limit'))return 'Gemini đang hết hạn mức; bản nháp hiện được đọc bằng quy tắc. Hãy thử lại khi hạn mức được cấp lại.';
 if(warning.includes('OCR unavailable'))return 'Chưa có công cụ đọc ảnh. Hãy dùng PDF có chữ hoặc dán nội dung báo giá.';
 if(warning.includes('OCR failed'))return 'Không đọc được ảnh. Hãy dán nội dung báo giá và kiểm tra thủ công.';
 if(warning.includes('OCR text may contain'))return 'Chữ được đọc từ ảnh có thể sai; kiểm tra lại số liệu với tài liệu gốc.';
 if(warning==='No readable quotation text found.')return 'Chưa tìm thấy nội dung báo giá đọc được.';
 return warning;
}
export function ExtractionReview({result}:{result:Extraction}){
 const count=Object.keys(result.fieldSources||result.quotation).filter(key=>key in names).length;
 const source=result.llmStatus==='used'?'Đã xử lý qua API AI':result.llmStatus==='rate_limited'?'API AI đang hết hạn mức; đang dùng kết quả đọc bằng quy tắc':result.llmStatus==='failed'?'API AI chưa xử lý được; đang dùng kết quả đọc bằng quy tắc':'Chưa cấu hình API AI; đang đọc bằng quy tắc';
 return <Alert type="warning" showIcon message={`Bản nháp: đọc được ${count}/7 trường`} description={<>
  <p>{source}. Kiểm tra các ô bên dưới với tài liệu gốc rồi bấm Xác nhận &amp; lưu.</p>
  {[...new Set(result.warnings.map(warningText))].map(warning=><p key={warning}>{warning}</p>)}
  {Object.entries(result.evidence||{}).length>0&&<details><summary>Xem nội dung gốc được AI sử dụng</summary>{Object.entries(result.evidence||{}).map(([field,evidence])=><p key={field}><strong>{names[field]||field}:</strong> {evidence}</p>)}</details>}
 </>}/>;
}
