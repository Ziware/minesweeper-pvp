import nodemailer from 'nodemailer';
import { env } from '../env';

const transporter = nodemailer.createTransport({
  host:   env.SMTP_HOST,
  port:   env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

export async function sendVerificationCode(to: string, code: string): Promise<void> {
  await transporter.sendMail({
    from:    env.SMTP_FROM,
    to,
    subject: 'Подтверждение email — Minesweeper PvP',
    text:    `Ваш код подтверждения: ${code}\n\nКод действителен 15 минут.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#e67e22;">Minesweeper PvP</h2>
        <p>Для завершения регистрации введите код подтверждения:</p>
        <div style="font-size:2rem;font-weight:bold;letter-spacing:0.4em;
                    background:#1a1a2e;color:#ffe066;padding:16px 24px;
                    border-radius:8px;display:inline-block;margin:16px 0;">
          ${code}
        </div>
        <p style="color:#888;">Код действителен 15 минут.<br>
           Если вы не регистрировались — просто проигнорируйте это письмо.</p>
      </div>
    `,
  });
}
