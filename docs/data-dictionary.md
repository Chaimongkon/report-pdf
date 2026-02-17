# Data Dictionary — ISCODOH (GCOOP)

> สหกรณ์ออมทรัพย์กรมทางหลวง | Oracle 12c | สำรวจเมื่อ 2026-02-16

## MBMEMBMASTER — ข้อมูลหลักสมาชิก (51,379 rows)

PK: `COOP_ID` + `MEMBER_NO`

| # | Column | Type | JOIN ไปที่ | ความหมาย |
|---|--------|------|-----------|----------|
| 1 | COOP_ID | CHAR(6) | — | รหัสสหกรณ์ (056001) |
| 2 | MEMBER_NO | CHAR(8) | — | เลขที่สมาชิก |
| 3 | PRENAME_CODE | CHAR(2) | **MBUCFPRENAME** | คำนำหน้า (01=นาย, 02=นาง, 03=น.ส.) |
| 4 | MEMB_NAME | VARCHAR2(60) | — | ชื่อ |
| 5 | MEMB_SURNAME | VARCHAR2(60) | — | นามสกุล |
| 6 | MEMB_ENAME | VARCHAR2(60) | — | ชื่อภาษาอังกฤษ |
| 7 | MEMB_ESURNAME | VARCHAR2(60) | — | นามสกุลภาษาอังกฤษ |
| 8 | MEMBCAT_CODE | CHAR(2) | MBUCFMEMBTYPE.MEMBCAT_CODE | หมวดสมาชิก (10=สามัญ, 20=สมทบ, 40=หน่วยงาน) |
| 9 | MEMBTYPE_CODE | CHAR(2) | **MBUCFMEMBTYPE** | ประเภทสมาชิก |
| 10 | MEMBGROUP_CODE | CHAR(3) | **MBUCFMEMBGROUP** | กลุ่ม/หน่วยงาน (แขวงทางหลวง) |
| 11 | BIRTH_DATE | DATE | — | วันเกิด |
| 12 | MEMBER_DATE | DATE | — | วันสมัครสมาชิก |
| 13 | DEAD_STATUS | NUMBER | — | สถานะเสียชีวิต (0=ไม่, 1=ใช่) |
| 14 | RETIRE_STATUS | NUMBER | — | สถานะเกษียณ |
| 15 | RETIRE_DATE | DATE | — | วันเกษียณ |
| 16 | RESIGN_STATUS | NUMBER | — | สถานะลาออก (0=ไม่, 1=ลาออก) |
| 17 | RESIGN_DATE | DATE | — | วันลาออก |
| 18 | SEX | CHAR(1) | — | เพศ (M/F) |
| 19 | MARIAGE_STATUS | NUMBER | — | สถานภาพสมรส |
| 20 | ADDRESS_NO | VARCHAR2(100) | — | ที่อยู่ |
| 21 | TAMBOL_CODE | CHAR(6) | **MBUCFTAMBOL** | ตำบล |
| 22 | DISTRICT_CODE | CHAR(4) | **MBUCFDISTRICT** | อำเภอ |
| 23 | PROVINCE_CODE | CHAR(3) | **MBUCFPROVINCE** | จังหวัด |
| 24 | POSTCODE | CHAR(5) | — | รหัสไปรษณีย์ |
| 25 | MEM_TELMOBILE | VARCHAR2(50) | — | เบอร์มือถือ |
| 26 | CARD_PERSON | CHAR(13) | — | เลขบัตรประชาชน |
| 27 | POSITION_CODE | CHAR(8) | **MBUCFPOSITION** (625 rows) | ตำแหน่ง |
| 28 | SALARY_AMOUNT | NUMBER | — | เงินเดือน |
| 29 | MEMBER_STATUS | NUMBER | — | สถานะสมาชิก (-1=ลาออก, 0=ปกติ?) |
| 30 | NATIONALITY | VARCHAR2(50) | — | สัญชาติ |
| 31 | APPLTYPE_CODE | CHAR(2) | **MBUCFAPPLTYPE** (21 rows) | ประเภทการสมัคร |

## Lookup Tables

### MBUCFPRENAME — คำนำหน้า
| PRENAME_CODE | PRENAME_DESC | PRENAME_SHORT |
|-------------|-------------|---------------|
| 01 | นาย | นาย |
| 02 | นาง | นาง |
| 03 | นางสาว | น.ส. |
| 04 | เด็กชาย | ด.ช. |
| 05 | เด็กหญิง | ด.ญ. |
| 06 | ดร. | ดร. |

### MBUCFMEMBTYPE — ประเภทสมาชิก (36 rows)
| MEMBTYPE_CODE | MEMBCAT_CODE | MEMBTYPE_DESC |
|--------------|-------------|---------------|
| 01 | 10 | ข้าราชการ |
| 02 | 10 | ลูกจ้างประจำ |
| 03 | 10 | พนักงานราชการ |
| 04 | 10 | ข้าราชการบำนาญ |
| 05 | 10 | บุคคลในครอบครัว |
| 06 | 10 | เจ้าหน้าที่ ฌสทล. |
| 08 | 10 | สโมสรสวัสดิการ |
| 09 | 10 | พนักงานราชการ (ส่วนภูมิภาค) |
| 10 | 10 | พนักงานด่าน |
| 11 | 10 | สังกัดหน่วยงาน |
| 12 | 10 | เกษียณก่อนกำหนด |
| 13 | 10 | เกษียณบำเหน็จ |
| 14 | 10 | พนักงานราชการ (ส่วนกลาง) |
| 22 | 20 | ลูกจ้างชั่วคราว |
| 29 | 20 | ลูกจ้างชั่วคราว |
| 41 | 40 | หน่วยงาน |

### MBUCFMEMBGROUP — กลุ่มสมาชิก/หน่วยงาน
JOIN: `COOP_ID` + `MEMBGROUP_CODE`
Columns: MEMBGROUP_CODE, MEMBGROUP_DESC, ADDRESS, PROVINCE_CODE, etc.
ตัวอย่าง: 430=สำนักงานทางหลวงที่ 11, 431=แขวงทางหลวงลพบุรีที่ 1, ...

### MBUCFPROVINCE — จังหวัด (77 rows)
JOIN: `PROVINCE_CODE`

### MBUCFDISTRICT — อำเภอ (928 rows)
JOIN: `DISTRICT_CODE`

### MBUCFTAMBOL — ตำบล (7,441 rows)
JOIN: `TAMBOL_CODE`

### MBUCFPOSITION — ตำแหน่ง (625 rows)
JOIN: `POSITION_CODE`

## Related Tables (FK to MBMEMBMASTER)

| ตาราง | Rows | JOIN Key | ความหมาย |
|--------|------|----------|----------|
| MBMEMBADDRESS | 33,853 | COOP_ID + MEMBER_NO | ที่อยู่เพิ่มเติม |
| MBMEMBFAMILY | 0 | COOP_ID + MEMBER_NO | ครอบครัว |
| MBMEMBERNOTE | 99,902 | — | บันทึก/หมายเหตุ |
| MBMEMBBONUS | 15,608 | — | โบนัส |
| MBMEMBMONEYRETURN | 25,663 | — | เงินคืน |
| MBMEMBMONEYTR | 33,046 | — | รายการเงิน |
| MBADJSALARY | 60,236 | — | ปรับเงินเดือน |
| MBREQAPPL | 6,726 | — | คำขอสมัคร |

## SQL Template: Member Report with JOINs

```sql
SELECT
  m.MEMBER_NO,
  pn.PRENAME_DESC,
  m.MEMB_NAME,
  m.MEMB_SURNAME,
  mt.MEMBTYPE_DESC,
  mg.MEMBGROUP_DESC,
  m.MEMBER_DATE,
  m.BIRTH_DATE,
  m.CARD_PERSON,
  m.MEM_TELMOBILE,
  m.SALARY_AMOUNT,
  m.MEMBER_STATUS,
  pv.PROVINCE_DESC,
  dt.DISTRICT_DESC,
  tb.TAMBOL_DESC
FROM ISCODOH.MBMEMBMASTER m
LEFT JOIN ISCODOH.MBUCFPRENAME pn     ON m.PRENAME_CODE = pn.PRENAME_CODE
LEFT JOIN ISCODOH.MBUCFMEMBTYPE mt    ON m.COOP_ID = mt.COOP_ID AND m.MEMBTYPE_CODE = mt.MEMBTYPE_CODE
LEFT JOIN ISCODOH.MBUCFMEMBGROUP mg   ON m.COOP_ID = mg.COOP_ID AND m.MEMBGROUP_CODE = mg.MEMBGROUP_CODE
LEFT JOIN ISCODOH.MBUCFPROVINCE pv    ON m.PROVINCE_CODE = pv.PROVINCE_CODE
LEFT JOIN ISCODOH.MBUCFDISTRICT dt    ON m.DISTRICT_CODE = dt.DISTRICT_CODE
LEFT JOIN ISCODOH.MBUCFTAMBOL tb      ON m.TAMBOL_CODE = tb.TAMBOL_CODE
WHERE m.MEMBER_STATUS >= 0
ORDER BY m.MEMBER_NO
```
