import {createTransport} from 'nodemailer';

/** `to` is the supplier; `sender` is the email of the user whose action queued the mail. */
export interface Mail {to:string;sender?:string;subject:string;text:string;attachments?:{filename:string;content:Buffer}[]}
export type Mailer=(mail:Mail)=>Promise<void>;

/** Real sending is on only when SMTP_USER and SMTP_PASSWORD are set. With
 * MAIL_REDIRECT_TO=sender every message goes to the user who sent it, and with
 * an address there to that one address, instead of the supplier; the subject
 * then names the supplier it was meant for. */
export function mailerFromEnv(env:NodeJS.ProcessEnv=process.env):Mailer|undefined{
 const user=env.SMTP_USER,pass=env.SMTP_PASSWORD;if(!user||!pass)return undefined;
 const port=Number(env.SMTP_PORT||465),target=env.MAIL_REDIRECT_TO;
 const transport=createTransport({host:env.SMTP_HOST||'smtp.gmail.com',port,secure:port===465,auth:{user,pass},connectionTimeout:15000,socketTimeout:30000});
 const from={name:env.MAIL_FROM_NAME||'ProcureIQ',address:env.MAIL_FROM||user};
 return async mail=>{const redirect=target==='sender'?mail.sender:target;await transport.sendMail({from,to:redirect||mail.to,subject:redirect?`${mail.subject} (gửi thay cho ${mail.to})`:mail.subject,text:mail.text,attachments:mail.attachments})};
}
