# Tài Liệu Toàn Diện: Các Câu Lệnh SQL Truy Vấn Đọc Dữ Liệu (GET Data / Read Queries)

> **Hệ thống:** NexusLib / UITLib (Hệ thống Quản lý Thư viện Đại học)  
> **Môn học:** Cơ sở dữ liệu (CSDL) - Đại học Công nghệ Thông tin (UIT)  
> **Cơ sở dữ liệu:** MySQL 8.4 (InnoDB, Fulltext Index, Window Functions, Lateral Joins, Views)  
> **Tài liệu Bách khoa Tổng hợp Toàn diện (Gồm cả 23 SP, 8 Functions, 17 Triggers, 13 Views):** 👉 [`docs/tai_lieu_tong_hop_toan_bo_co_so_du_lieu_uitlib.md`](file:///d:/qltt/uitlib/docs/tai_lieu_tong_hop_toan_bo_co_so_du_lieu_uitlib.md)

Tài liệu này tổng hợp toàn bộ các kỹ thuật và câu lệnh SQL được hệ thống sử dụng để **đọc, tra cứu, tổng hợp và báo cáo dữ liệu** (`GET`), phục vụ báo cáo đồ án môn học và nghiên cứu kỹ thuật tối ưu hóa truy vấn CSDL.

---

## MỤC LỤC

1. [Tra cứu & Tìm kiếm Mục lục Sách (Catalog Search)](#1-tra-cứu--tìm-kiếm-mục-lục-sách)
2. [Lưu thông Mượn trả & Quét thẻ / Mã vạch (Circulation Desk)](#2-lưu-thông-mượn-trả--quét-thẻ--mã-vạch)
3. [Quản lý Tiền phạt, Công nợ & Thanh toán (Fines & Balance)](#3-quản-lý-tiền-phạt-công-nợ--thanh-toán)
4. [Hàng đợi Đặt trước với Window Functions (Reservations)](#4-hàng-đợi-đặt-trước-với-window-functions)
5. [Tra cứu Bạn đọc & Thẻ thư viện (Readers & Cards)](#5-tra-cứu-bạn-đọc--thẻ-thư-viện)
6. [Các View Báo cáo & Thống kê Phân tích (Report Views)](#6-các-view-báo-cáo--thống-kê-phân-tích)
7. [Các View Kiểm tra Bất biến Toàn vẹn Dữ liệu (Invariant Views)](#7-các-view-kiểm-tra-bất-biến-toàn-vẹn)

---

## 1. Tra cứu & Tìm kiếm Mục lục Sách

### 1.1. Tìm kiếm Fulltext kết hợp tiền tố tác giả (Union Derived Table)
- **Mục đích:** Tìm sách theo từ khóa bất kỳ trên tiêu đề, phụ đề hoặc tên tác giả mà vẫn tận dụng tối đa chỉ mục (Fulltext Index `title_subtitle_ft` và B-Tree Index `authors_name_ix`).
- **File nguồn:** `src/server/api/queries/catalog-search.ts`

```sql
-- Khi người dùng nhập từ khóa tìm kiếm: 'Clean Code' hoặc 'Martin'
SELECT b.id, b.title, b.subtitle, b.published_year, b.language_code, b.cover_url,
       b.published_date_text, b.description, b.classification_code, b.replacement_cost_vnd, b.status,
       mt.code AS material_type, p.id AS publisher_id, p.name AS publisher_name
  FROM books b
  JOIN material_types mt ON mt.id = b.material_type_id
  LEFT JOIN publishers p ON p.id = b.publisher_id
  JOIN (
    -- Nhánh 1: Tìm kiếm toàn văn trên tiêu đề/phụ đề sách
    SELECT id FROM books 
     WHERE MATCH(title, subtitle) AGAINST ('Clean* Code*' IN BOOLEAN MODE)
    UNION 
    -- Nhánh 2: Tìm kiếm theo tiền tố tên tác giả
    SELECT ba.book_id 
      FROM authors a 
      JOIN book_authors ba ON ba.author_id = a.id
     WHERE a.name LIKE CONCAT('Clean Code', '%')
  ) m ON m.id = b.id
 WHERE b.status = 'active'
 ORDER BY b.title, b.id
 LIMIT 20 OFFSET 0;
```

### 1.2. Lọc theo cây danh mục phân cấp (Parent - Child Categories)
- **Mục đích:** Khi chọn danh mục cha (VD: "Khoa học máy tính"), truy vấn lấy được toàn bộ sách thuộc danh mục cha và các danh mục con (VD: "Cơ sở dữ liệu", "Mạng máy tính").

```sql
SELECT b.id, b.title
  FROM books b
 WHERE b.status = 'active'
   AND b.id IN (
     SELECT bc.book_id 
       FROM book_categories bc 
       JOIN categories c ON c.id = bc.category_id
      WHERE c.id = :categoryId OR c.parent_id = :categoryId
   );
```

### 1.3. Gom nhóm và đếm số lượng bản sao khả dụng (Grouped Availability)
- **Mục đích:** Lấy số lượng bản sao sẵn sàng (`available`) và tổng số bản sao còn lưu hành (không tính sách đã mất hoặc thanh lý) cho một danh sách sách trên trang kết quả.

```sql
SELECT book_id,
       SUM(circulation_status = 'available') AS available,
       SUM(circulation_status NOT IN ('retired', 'lost')) AS total
  FROM book_copies 
 WHERE book_id IN (1, 2, 3, 4, 5) 
 GROUP BY book_id;
```

---

## 2. Lưu thông Mượn trả & Quét thẻ / Mã vạch

### 2.1. Tra cứu toàn bộ sách mượn của bạn đọc (kèm cờ Quá hạn)
- **Mục đích:** Hiển thị danh sách ấn phẩm bạn đọc đang mượn hoặc lịch sử mượn trả, tự động tính toán cờ quá hạn (`overdue`).
- **File nguồn:** `src/server/api/queries/loans.ts`

```sql
SELECT li.id, li.loan_id, li.copy_id, c.barcode, b.id AS book_id, b.title, 
       li.borrowed_at, li.due_at, li.status, li.returned_at, li.return_condition, 
       li.renewal_count, li.applied_max_renewals,
       (li.status = 'on_loan' AND li.due_at < UTC_TIMESTAMP(3)) AS is_overdue
  FROM loan_items li
  JOIN loans l ON l.id = li.loan_id
  JOIN book_copies c ON c.id = li.copy_id
  JOIN books b ON b.id = c.book_id
 WHERE l.reader_id = :readerId
   AND li.status = 'on_loan'
 ORDER BY li.borrowed_at DESC, li.id DESC
 LIMIT 20 OFFSET 0;
```

### 2.2. Quét nhanh bản sao theo mã vạch (Barcode Scan at Desk)
- **Mục đích:** Khi thủ thư quét mã vạch cuốn sách tại quầy, truy vấn xác định bản sao này đang được mượn bởi ai (nếu đang cho mượn) hoặc đang giữ chỗ cho ai (nếu đang ở kệ hold).
- **Điểm sáng tạo kiến trúc:** Sử dụng các cột sinh ảo `open_copy_id` và `ready_copy_id` để `LEFT JOIN` cực nhanh.

```sql
SELECT c.id, c.book_id, c.barcode, c.shelf_code, c.acquired_at, c.physical_condition, c.circulation_status,
       li.id AS open_loan_item_id, 
       rs.id AS reservation_id, 
       rs.reader_id AS hold_reader_id, 
       rs.hold_expires_at
  FROM book_copies c
  LEFT JOIN loan_items li ON li.open_copy_id = c.id
  LEFT JOIN reservations rs ON rs.ready_copy_id = c.id
 WHERE c.barcode = 'M001';
```

### 2.3. Quét thẻ thư viện & Kiểm tra tính hợp lệ tức thời
- **Mục đích:** Tra cứu thẻ và kiểm tra thẻ còn hiệu lực hay không trực tiếp trong câu lệnh SQL.

```sql
SELECT k.id, k.reader_id, k.card_number, k.issued_at, k.expires_at, k.status,
       (k.status = 'active' AND k.expires_at > UTC_TIMESTAMP(3)) AS valid_now,
       r.full_name, r.email, r.phone, rt.code AS reader_type, r.status AS reader_status, 
       r.user_id, r.created_at
  FROM library_cards k
  JOIN readers r ON r.id = k.reader_id
  JOIN reader_types rt ON rt.id = r.reader_type_id
 WHERE k.card_number = 'C2026-0001';
```

---

## 3. Quản lý Tiền phạt, Công nợ & Thanh toán

### 3.1. Tính toán biến động công nợ bằng `LEFT JOIN LATERAL`
- **Mục đích:** Một khoản phạt gốc có thể bị điều chỉnh tăng/giảm nhiều lần (`fine_adjustments`) và được trả từng phần qua nhiều lần thanh toán (`fine_payment_allocations`).
- **File nguồn:** `src/server/api/queries/money.ts`

```sql
SELECT f.id, f.loan_item_id, f.fine_type, f.default_amount_vnd, f.assessed_amount_vnd, f.reason,
       f.assessed_at, b.id AS book_id, b.title,
       -- Tổng điều chỉnh miễn giảm đã áp dụng
       adj.s AS adjustments_vnd,
       -- Tổng số tiền đã thanh toán cấn trừ vào khoản phạt này
       al.s AS allocated_vnd,
       -- Tiền phạt thực tế còn lại phải thu
       (f.assessed_amount_vnd + adj.s - al.s) AS remaining_vnd
  FROM fines f
  JOIN loan_items li ON li.id = f.loan_item_id
  JOIN loans l ON l.id = li.loan_id
  JOIN book_copies bc ON bc.id = li.copy_id
  JOIN books b ON b.id = bc.book_id
  -- Kỹ thuật LATERAL JOIN gom nhóm tính tổng con ngay tại mỗi dòng phạt:
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(a.amount_vnd), 0) AS s 
      FROM fine_adjustments a 
     WHERE a.fine_id = f.id
  ) adj ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(x.amount_vnd), 0) AS s 
      FROM fine_payment_allocations x 
     WHERE x.fine_id = f.id
  ) al ON TRUE
 WHERE l.reader_id = :readerId
   AND (f.assessed_amount_vnd + adj.s - al.s) > 0  -- Chỉ lấy các khoản còn nợ (nếu lọc open=true)
 ORDER BY f.assessed_at DESC, f.id DESC;
```

### 3.2. Tính tổng dư nợ độc giả tại thời điểm bất kỳ (Point-in-time Balance)
- **Mục đích:** Tính chính xác công nợ của độc giả tại thời điểm `dbNow` để phục vụ đối soát kiểm toán và chặn mượn sách nếu vượt hạn mức nợ.

```sql
SELECT COALESCE(SUM(f.assessed_amount_vnd + adj.s - al.s), 0) AS outstanding_vnd
  FROM fines f
  JOIN loan_items li ON li.id = f.loan_item_id
  JOIN loans l ON l.id = li.loan_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(a.amount_vnd), 0) AS s 
      FROM fine_adjustments a
     WHERE a.fine_id = f.id AND a.adjusted_at <= :dbNow
  ) adj ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(x.amount_vnd), 0) AS s
      FROM fine_payment_allocations x 
      JOIN fine_payments p ON p.id = x.payment_id
     WHERE x.fine_id = f.id AND p.paid_at <= :dbNow
  ) al ON TRUE
 WHERE l.reader_id = :readerId 
   AND f.assessed_at <= :dbNow;
```

---

## 4. Hàng đợi Đặt trước với Window Functions

### 4.1. Tính số thứ tự trong hàng đợi chờ sách bằng `ROW_NUMBER()`
- **Mục đích:** Khi nhiều bạn đọc cùng đặt trước 1 cuốn sách, truy vấn tự động xác định bạn đọc đang ở vị trí thứ mấy trong hàng đợi (`queue_position`) mà không cần lưu cột cứng.
- **File nguồn:** `src/server/api/queries/reservations.ts`

```sql
SELECT r.id, r.reader_id, r.book_id, b.title, r.status, r.requested_at, 
       q.queue_position, r.ready_at, r.hold_expires_at, r.assigned_copy_id, 
       r.closed_at, r.close_reason
  FROM reservations r
  JOIN books b ON b.id = r.book_id
  LEFT JOIN (
    -- Sử dụng Window Function phân vùng theo từng đầu sách và sắp xếp theo thời gian yêu cầu
    SELECT id, 
           ROW_NUMBER() OVER (
             PARTITION BY book_id 
             ORDER BY requested_at, id
           ) AS queue_position
      FROM reservations 
     WHERE status = 'waiting'
  ) q ON q.id = r.id
 WHERE r.reader_id = :readerId
 ORDER BY r.requested_at DESC, r.id DESC;
```

---

## 5. Tra cứu Bạn đọc & Thẻ thư viện

### 5.1. Lấy thông tin độc giả và Thẻ thư viện còn hiệu lực
- **Điểm sáng tạo kiến trúc:** Bảng `library_cards` có cột sinh ảo `active_reader_id` (chỉ mang giá trị `reader_id` khi thẻ đang `active`, ngược lại mang `NULL`). Nhờ đó, việc lấy thẻ active chỉ cần 1 câu lệnh `LEFT JOIN` đơn giản mà không cần lọc subquery.
- **File nguồn:** `src/server/api/queries/people.ts`

```sql
SELECT r.id, r.full_name, r.email, r.phone, rt.code AS reader_type, r.status, r.user_id, r.created_at,
       c.id AS card_id, c.card_number, c.issued_at, c.expires_at, c.status AS card_status
  FROM readers r
  JOIN reader_types rt ON rt.id = r.reader_type_id
  LEFT JOIN library_cards c ON c.active_reader_id = r.id
 WHERE r.id = :readerId;
```

---

## 6. Các View Báo cáo & Thống kê Phân tích

Cơ sở dữ liệu định nghĩa sẵn 4 View chuyên dụng cho phân tích báo cáo (Bussiness Intelligence / Reporting).

### 6.1. Báo cáo Sách đang Quá hạn (`v_report_overdue`)
- **Định nghĩa View:** Liệt kê toàn bộ sách đang mượn đã vượt quá hạn trả, tính toán số ngày trễ theo thời gian thực.
- **File:** `drizzle/20260924111847_us4_reports/migration.sql`

```sql
CREATE VIEW `v_report_overdue` AS
SELECT r.id AS reader_id, r.full_name, b.title, c.barcode, li.id AS loan_item_id, li.due_at,
       fn_days_late(li.due_at, UTC_TIMESTAMP(3)) AS days_late
  FROM loan_items li
  JOIN loans l ON l.id = li.loan_id
  JOIN readers r ON r.id = l.reader_id
  JOIN book_copies c ON c.id = li.copy_id
  JOIN books b ON b.id = c.book_id
 WHERE li.status = 'on_loan' 
   AND li.due_at < UTC_TIMESTAMP(3);
```

### 6.2. Báo cáo Lượt mượn theo Tháng & Đối tượng (`v_report_loans_by_month`)
- **Định nghĩa View:** Thống kê số lượng phiếu mượn và số lượng đầu sách mượn phân bổ theo tháng địa phương (UTC+7) và đối tượng độc giả (Sinh viên, Giảng viên, Bạn đọc ngoài).

```sql
CREATE VIEW `v_report_loans_by_month` AS
SELECT DATE_FORMAT(fn_local_date(l.borrowed_at), '%Y-%m') AS month_local, 
       rt.code AS reader_type,
       COUNT(DISTINCT l.id) AS loans, 
       COUNT(li.id) AS items
  FROM loans l
  JOIN readers r ON r.id = l.reader_id
  JOIN reader_types rt ON rt.id = r.reader_type_id
  JOIN loan_items li ON li.loan_id = l.id
 GROUP BY DATE_FORMAT(fn_local_date(l.borrowed_at), '%Y-%m'), rt.code;
```

### 6.3. Báo cáo Đầu sách được Mượn nhiều nhất (`v_report_popular_books`)
- **Định nghĩa View:** Xếp hạng các đầu sách có tần suất mượn cao nhất toàn hệ thống.

```sql
CREATE VIEW `v_report_popular_books` AS
SELECT b.id AS book_id, b.title, COUNT(li.id) AS loan_items
  FROM books b
  JOIN book_copies c ON c.book_id = b.id
  JOIN loan_items li ON li.copy_id = c.id
 GROUP BY b.id, b.title;
```

### 6.4. Báo cáo Tổng hợp Phân bổ Trạng thái Bản sao (`v_report_copy_status`)
- **Định nghĩa View:** Ứng dụng kỹ thuật **Conditional Aggregation** (`SUM(condition)`) để xoay trục (pivot) trạng thái các bản sao sách trong một câu truy vấn duy nhất.

```sql
CREATE VIEW `v_report_copy_status` AS
SELECT b.id AS book_id, b.title,
       SUM(c.circulation_status = 'available') AS available,
       SUM(c.circulation_status = 'on_loan')   AS on_loan,
       SUM(c.circulation_status = 'on_hold')   AS on_hold,
       SUM(c.circulation_status = 'in_repair') AS in_repair,
       SUM(c.circulation_status = 'lost')      AS lost,
       SUM(c.circulation_status = 'retired')   AS retired,
       COUNT(c.id)                             AS total
  FROM books b
  JOIN book_copies c ON c.book_id = b.id
 GROUP BY b.id, b.title;
```

---

## 7. Các View Kiểm tra Bất biến Toàn vẹn (Invariant Views)

Trong kiến trúc NexusLib, các View bất biến (`v_inv_*`) được sử dụng để kiểm toán và đảm bảo CSDL không bao giờ bị rơi vào trạng thái không nhất quán logic. **Khi hệ thống hoạt động đúng, toàn bộ các View này phải trả về 0 dòng.**

| Tên View Bất biến | Câu lệnh SQL phát hiện vi phạm | Ý nghĩa toàn vẹn logic |
|---|---|---|
| `v_inv_copy_on_loan` | `SELECT c.id FROM book_copies c LEFT JOIN loan_items li ON li.open_copy_id = c.id WHERE (c.circulation_status = 'on_loan') <> (li.id IS NOT NULL)` | Bản sao có trạng thái `on_loan` nhưng không tìm thấy dòng mượn đang mở tương ứng. |
| `v_inv_copy_on_hold` | `SELECT c.id FROM book_copies c LEFT JOIN reservations r ON r.ready_copy_id = c.id WHERE (c.circulation_status = 'on_hold') <> (r.id IS NOT NULL)` | Bản sao ở trạng thái giữ chỗ `on_hold` nhưng không gắn với đơn đặt trước nào đang sẵn sàng. |
| `v_inv_queue_available` | `SELECT r.id FROM reservations r JOIN book_copies c ON c.book_id = r.book_id WHERE r.status = 'waiting' AND c.circulation_status = 'available'` | Có sách sẵn sàng trên giá (`available`) nhưng lại có bạn đọc đang phải xếp hàng chờ mượn (`waiting`). |
| `v_inv_fine_balance` | `SELECT f.id FROM fines f WHERE f.assessed_amount_vnd + (SELECT COALESCE(SUM(amount_vnd),0) FROM fine_adjustments WHERE fine_id = f.id) < (SELECT COALESCE(SUM(amount_vnd),0) FROM fine_payment_allocations WHERE fine_id = f.id)` | Số tiền thanh toán cấn trừ vượt quá số tiền nợ thực tế của khoản phạt. |
| `v_inv_damaged_lendable` | `SELECT id FROM book_copies WHERE physical_condition = 'damaged' AND circulation_status IN ('available', 'on_loan', 'on_hold')` | Sách bị hư hại nhưng vẫn đang cho mượn hoặc để ở trạng thái sẵn sàng. |
