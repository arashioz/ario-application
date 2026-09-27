import fs from 'fs';
import { Router, Request, Response, NextFunction } from 'express';
import { getSession } from '../services/authService';
import {
  listDbCollections,
  streamCollectionJson,
  createFullBackup,
  listBackups,
  resolveBackupPath,
  deleteBackup,
  buildFinanceExport,
  buildFinanceWorkbook,
} from '../services/backupService';
import { parseLocalDateInput, startOfDay, endOfDay } from '../utils/persian';

type AdminRequest = Request & { adminId?: string; adminName?: string };

const router = Router();

async function requireAdmin(req: AdminRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const session = await getSession(token).catch(() => null);
  if (!session) {
    res.status(401).json({ error: 'ابتدا وارد شوید' });
    return;
  }
  if (session.role !== 'admin') {
    res.status(403).json({ error: 'فقط مدیر دسترسی دارد' });
    return;
  }
  req.adminId = session.userId;
  req.adminName = session.name;
  next();
}

function handle(fn: (req: AdminRequest, res: Response) => Promise<void>) {
  return (req: AdminRequest, res: Response) => {
    fn(req, res).catch((err) => {
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      res.status(400).json({ error: err instanceof Error ? err.message : 'خطای سرور' });
    });
  };
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function attachment(res: Response, filename: string, type: string) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
}

function readRange(req: Request) {
  const from = req.query.from ? startOfDay(parseLocalDateInput(String(req.query.from))) : undefined;
  const to = req.query.to ? endOfDay(parseLocalDateInput(String(req.query.to))) : undefined;
  return { from, to };
}

router.use(requireAdmin);

// ─── جدول‌های دیتابیس ───
router.get('/collections', handle(async (_req, res) => {
  res.json(await listDbCollections());
}));

router.get('/collections/:name/export', handle(async (req, res) => {
  const name = String(req.params.name);
  attachment(res, `ario-${name}-${stamp()}.json`, 'application/json; charset=utf-8');
  await streamCollectionJson(name, res);
  res.end();
}));

// ─── بکاپ کامل روی سرور ───
router.get('/backups', handle(async (_req, res) => {
  res.json(await listBackups());
}));

router.post('/backups', handle(async (req, res) => {
  res.status(201).json(await createFullBackup('manual', req.adminName));
}));

router.get('/backups/:file/download', handle(async (req, res) => {
  const full = resolveBackupPath(String(req.params.file));
  attachment(res, String(req.params.file), 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String((await fs.promises.stat(full)).size));
  fs.createReadStream(full).pipe(res);
}));

router.delete('/backups/:file', handle(async (req, res) => {
  await deleteBackup(String(req.params.file));
  res.json({ ok: true });
}));

// ─── خروجی مالی: پرداخت به شرکت + صندوق ───
router.get('/export/finance.json', handle(async (req, res) => {
  const { from, to } = readRange(req);
  const data = await buildFinanceExport(from, to);
  attachment(res, `ario-finance-${stamp()}.json`, 'application/json; charset=utf-8');
  res.send(JSON.stringify(data, null, 2));
}));

router.get('/export/finance.xlsx', handle(async (req, res) => {
  const { from, to } = readRange(req);
  const buf = await buildFinanceWorkbook(await buildFinanceExport(from, to));
  attachment(res, `ario-finance-${stamp()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}));

export default router;
