# PDF Report Generator — jsreport + Oracle

ระบบสร้างรายงาน PDF จากฐานข้อมูล Oracle ด้วย jsreport + Chrome PDF rendering

## Architecture

```
Oracle DB ──(oracledb)──▶ Node.js Express API ──▶ jsreport Engine ──▶ PDF
                                                       │
                                             Handlebars Template
                                             + Chrome PDF rendering
                                             + pdf-utils (merge/append)
```

## Features

- **Single Report** — สร้าง PDF report เดี่ยวจากข้อมูล Oracle
- **Batch** — สร้าง PDF หลายไฟล์พร้อมกัน บันทึกเป็นไฟล์แยก
- **Merge** — สร้างหลาย report รวมเป็น PDF ไฟล์เดียว
- **Mock Data** — ทดสอบได้โดยไม่ต้องต่อ Oracle (`useMock: true`)
- **Thai Language** — รองรับภาษาไทยในรายงาน

## Prerequisites

- **Node.js** >= 18
- **Oracle Instant Client** (ถ้าต้องการเชื่อมต่อ Oracle)
  - Download: https://www.oracle.com/database/technologies/instant-client.html
  - เพิ่ม path ของ Instant Client ใน `PATH` environment variable

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure Oracle connection (optional)
#    Edit .env file with your Oracle credentials
cp .env.example .env

# 3. Start server
npm start

# 4. Test with mock data (no Oracle needed)
curl -X POST http://localhost:3000/api/report/sales \
  -H "Content-Type: application/json" \
  -d '{"useMock": true}' \
  --output report.pdf
```

## API Endpoints

### `POST /api/report/sales`

สร้าง Sales Report PDF เดี่ยว

| Parameter | Type | Description |
|-----------|------|-------------|
| `useMock` | boolean | ใช้ข้อมูลจำลอง (ไม่ต้องต่อ Oracle) |
| `startDate` | string | วันเริ่มต้น (YYYY-MM-DD) |
| `endDate` | string | วันสิ้นสุด (YYYY-MM-DD) |
| `department` | string | แผนก |

Query: `?save=true` — บันทึกเป็นไฟล์แทนการ stream

```bash
# Stream PDF
curl -X POST http://localhost:3000/api/report/sales \
  -H "Content-Type: application/json" \
  -d '{"useMock": true}' \
  --output report.pdf

# Save to disk
curl -X POST "http://localhost:3000/api/report/sales?save=true" \
  -H "Content-Type: application/json" \
  -d '{"useMock": true}'
```

### `POST /api/report/batch`

สร้าง PDF หลายไฟล์ บันทึกลง `./output/`

```json
{
  "useMock": true,
  "reports": [
    { "startDate": "2024-01-01", "endDate": "2024-03-31", "department": "Sales" },
    { "startDate": "2024-04-01", "endDate": "2024-06-30", "department": "Marketing" }
  ]
}
```

### `POST /api/report/merge`

สร้างหลาย report รวมเป็น PDF เดียว

```json
{
  "useMock": true,
  "reports": [
    { "startDate": "2024-01-01", "endDate": "2024-06-30", "department": "H1" },
    { "startDate": "2024-07-01", "endDate": "2024-12-31", "department": "H2" }
  ]
}
```

### `GET /api/report/health`

Health check endpoint

## Project Structure

```
report-pdf/
├── server.js                          # Main entry point
├── package.json
├── .env                               # Oracle config (gitignored)
├── .env.example                       # Config template
├── src/
│   ├── db/
│   │   └── oracle.js                  # Oracle connection pool
│   ├── routes/
│   │   └── report.js                  # Express API routes
│   ├── services/
│   │   └── reportService.js           # Data fetching (Oracle + mock)
│   └── utils/
│       └── pdfUtils.js                # PDF save/batch utilities
├── templates/
│   └── sales-report/
│       ├── content.html               # Handlebars HTML template
│       └── helpers.js                 # Template helpers
└── output/                            # Generated PDFs (gitignored)
```

## Custom Templates

สร้าง template ใหม่ใน `templates/` folder:

1. สร้าง folder ใหม่ เช่น `templates/invoice/`
2. สร้าง `content.html` — Handlebars template
3. สร้าง `helpers.js` — Custom helpers (optional)
4. เพิ่ม route ใน `src/routes/report.js`

## Oracle Setup

### Connection String Format

```
# Simple
localhost:1521/ORCL

# TNS
(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=localhost)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=ORCL)))
```

### Required Tables (Example)

```sql
-- ตัวอย่างโครงสร้างตาราง
CREATE TABLE CUSTOMERS (
  CUSTOMER_ID   NUMBER PRIMARY KEY,
  CUSTOMER_NAME VARCHAR2(200)
);

CREATE TABLE ORDERS (
  ORDER_ID      NUMBER PRIMARY KEY,
  CUSTOMER_ID   NUMBER REFERENCES CUSTOMERS(CUSTOMER_ID),
  ORDER_DATE    DATE,
  TOTAL_AMOUNT  NUMBER(12,2),
  STATUS        VARCHAR2(50)
);
```

## License

MIT
