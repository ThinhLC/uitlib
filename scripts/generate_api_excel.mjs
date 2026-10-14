import fs from 'fs';
import path from 'path';

const apis = [
  // I. Xác thực & Phiên làm việc (5 APIs)
  {
    stt: 1,
    category: 'Xác thực & Phiên làm việc',
    name: 'health',
    method: 'GET',
    path: '/api/v1/health',
    access: 'Public',
    procedure: 'Không (Liveness probe)',
    workflow: 'Kiểm tra trạng thái máy chủ (Liveness probe). Trả về {status: "ok"}. Không truy cập CSDL.',
    tables: 'Không',
    fields: 'Không',
    sampleInput: 'curl -X GET http://localhost:3000/api/v1/health'
  },
  {
    stt: 2,
    category: 'Xác thực & Phiên làm việc',
    name: 'me',
    method: 'GET',
    path: '/api/v1/me',
    access: 'Đã đăng nhập (Bearer Token)',
    procedure: 'Transaction Node.js (Ensure User)',
    workflow: 'Xác thực Supabase JWT. Nếu tài khoản đăng nhập lần đầu, tự động tạo app_users (FR-008a). Truy vấn hồ sơ bạn đọc tương ứng qua readers.user_id, danh sách vai trò (roles) và quyền hạn (permissions).',
    tables: 'app_users (Insert nếu mới), readers (Read), user_roles (Read), roles (Read), role_permissions (Read), permissions (Read)',
    fields: 'app_users: supabase_user_id, status, created_at',
    sampleInput: 'Header: Authorization: Bearer <supabase_jwt_token>'
  },
  {
    stt: 3,
    category: 'Xác thực & Phiên làm việc',
    name: 'signupHook',
    method: 'POST',
    path: '/api/v1/auth/hooks/before-user-created',
    access: 'Webhook Secret',
    procedure: 'Không (Supabase Hook)',
    workflow: 'Hook được gọi tự động bởi Supabase Auth trước khi tạo người dùng, nhằm xác thực email trường Đại học UIT hoặc kiểm tra ràng buộc đăng ký.',
    tables: 'Không',
    fields: 'Không',
    sampleInput: 'Body: {"user": {"email": "sinhvien@uit.edu.vn"}}'
  },
  {
    stt: 4,
    category: 'Xác thực & Phiên làm việc',
    name: 'authCallback',
    method: 'GET',
    path: '/api/v1/auth/callback',
    access: 'Public (OAuth PKCE)',
    procedure: 'Transaction Node.js',
    workflow: 'Nhận mã xác thực OAuth (Google sign-in) từ Supabase, đổi code lấy JWT session lưu cookie trình duyệt, đảm bảo tài khoản app_users tồn tại, sau đó chuyển hướng về URL đích (next).',
    tables: 'app_users (Insert nếu chưa có)',
    fields: 'app_users: supabase_user_id, status, created_at',
    sampleInput: 'Query: ?code=4/0AY0e...&next=/catalog'
  },
  {
    stt: 5,
    category: 'Xác thực & Phiên làm việc',
    name: 'authConfirm',
    method: 'GET',
    path: '/api/v1/auth/confirm',
    access: 'Public (Email OTP)',
    procedure: 'Không',
    workflow: 'Xác nhận liên kết email qua mã token_hash (magiclink/invite), thiết lập phiên làm việc cookie và chuyển hướng về trang next.',
    tables: 'Không',
    fields: 'Không',
    sampleInput: 'Query: ?token_hash=pkce_sample_hash&type=magiclink&next=/reader'
  },

  // II. Lưu thông mượn trả (7 APIs)
  {
    stt: 6,
    category: 'Lưu thông mượn trả',
    name: 'checkout',
    method: 'POST',
    path: '/api/v1/loans',
    access: 'Thủ thư (loan.checkout)',
    procedure: 'sp_checkout(p_reader_id, p_copy_ids_json, p_user_id)',
    workflow: 'Mượn 1-20 cuốn sách. Kiểm tra tính hợp lệ: Độc giả active, thẻ thư viện active và còn hạn, nợ phạt không vượt ngưỡng debt_block_threshold_vnd, không có sách trễ hạn quá mức, không vượt hạn mức mượn max_active_items. Chuyển trạng thái bản sao sang on_loan, tạo lượt mượn loans và chi tiết loan_items kèm hạn trả due_at theo chính sách.',
    tables: 'loans (Insert), loan_items (Insert), book_copies (Update), readers (Read), library_cards (Read), loan_policies (Read), fines (Read), reservations (Update nếu đang on_hold)',
    fields: 'loans: reader_id, processed_by_user_id, borrowed_at, status="open"; loan_items: loan_id, copy_id, policy_id, borrowed_at, due_at, status="on_loan", applied_loan_days, applied_max_renewals, applied_daily_fee_vnd; book_copies: circulation_status="on_loan", updated_at',
    sampleInput: 'Body: {"readerId": 1, "copyIds": [101, 102]}'
  },
  {
    stt: 7,
    category: 'Lưu thông mượn trả',
    name: 'returnItem',
    method: 'POST',
    path: '/api/v1/loan-items/:loanItemId/return',
    access: 'Thủ thư (loan.return)',
    procedure: 'sp_return_item(p_loan_item_id, p_condition, p_damaged_fine_vnd, p_reason, p_user_id)',
    workflow: 'Nhận trả một bản sao sách. Cập nhật loan_items.status="returned", ghi nhận tình trạng vật lý (good, worn, damaged). Tự động phạt trễ hạn (fine_type="late") nếu quá hạn, phạt hư hỏng nếu có. Nếu có người đang đặt chờ (waiting), chuyển bản sao thành on_hold, ngược lại thành available. Đóng loan nếu tất cả sách đã trả.',
    tables: 'loan_items (Update), book_copies (Update), fines (Insert nếu phạt), loans (Update), reservations (Update nếu có hàng đợi)',
    fields: 'loan_items: returned_at, return_condition, status="returned"; book_copies: physical_condition, circulation_status ("available" hoặc "on_hold"); fines: loan_item_id, fine_type, default_amount_vnd, assessed_amount_vnd, reason, assessed_at, assessed_by_user_id',
    sampleInput: 'Path: loanItemId=5; Body: {"condition": "damaged", "damagedFineVnd": 50000, "reason": "Rách bìa sách"}'
  },
  {
    stt: 8,
    category: 'Lưu thông mượn trả',
    name: 'declareLost',
    method: 'POST',
    path: '/api/v1/loan-items/:loanItemId/lost',
    access: 'Thủ thư (loan.return)',
    procedure: 'sp_declare_lost(p_loan_item_id, p_lost_fine_vnd, p_reason, p_user_id)',
    workflow: 'Ghi nhận bạn đọc làm mất sách. Cập nhật loan_items.status="lost", book_copies.circulation_status="lost". Đánh giá phạt trễ hạn đến ngày báo mất cộng với khoản phạt bồi thường sách mất (mặc định theo replacement_cost_vnd hoặc thủ thư chỉ định).',
    tables: 'loan_items (Update), book_copies (Update), fines (Insert), loans (Update)',
    fields: 'loan_items: status="lost", lost_declared_at; book_copies: circulation_status="lost"; fines: loan_item_id, fine_type="lost", default_amount_vnd, assessed_amount_vnd, reason',
    sampleInput: 'Path: loanItemId=8; Body: {"lostFineVnd": 150000, "reason": "Để quên tài liệu trên xe bus"}'
  },
  {
    stt: 9,
    category: 'Lưu thông mượn trả',
    name: 'renew',
    method: 'POST',
    path: '/api/v1/loan-items/:loanItemId/renew',
    access: 'Bạn đọc / Thủ thư (loan.renew)',
    procedure: 'sp_renew(p_loan_item_id, p_user_id)',
    workflow: 'Gia hạn sách thêm 1 chu kỳ mượn. Kiểm tra: sách đang mượn (on_loan), chưa bị quá hạn, renewal_count < applied_max_renewals, và không có người khác đang đặt trước sách này.',
    tables: 'loan_items (Update), loan_renewals (Insert), reservations (Read)',
    fields: 'loan_items: due_at (tăng thêm loan_days), renewal_count (+1); loan_renewals: loan_item_id, old_due_at, new_due_at, renewed_at, performed_by_user_id',
    sampleInput: 'Path: loanItemId=5; Body: {}'
  },
  {
    stt: 10,
    category: 'Lưu thông mượn trả',
    name: 'readerLoanItems',
    method: 'GET',
    path: '/api/v1/readers/:readerId/loan-items',
    access: 'Chính chủ hoặc Thủ thư (loan.checkout/loan.return)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Lấy danh sách các ấn phẩm bạn đọc đang mượn hoặc đã trả. Hỗ trợ lọc theo trạng thái (on_loan, returned, lost), cờ quá hạn (overdue) và phân trang.',
    tables: 'loan_items (Read), loans (Read), book_copies (Read), books (Read), fines (Read)',
    fields: 'loan_items.*, books.title, book_copies.barcode, fines.*',
    sampleInput: 'Path: readerId=1; Query: ?status=on_loan&overdue=false&page=1&pageSize=10'
  },
  {
    stt: 11,
    category: 'Lưu thông mượn trả',
    name: 'copyByBarcode',
    method: 'GET',
    path: '/api/v1/copies/by-barcode/:barcode',
    access: 'Thủ thư (catalog.write / loan.checkout / loan.return)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Quét mã vạch ấn phẩm tại quầy lưu thông. Trả về thông tin bản sao, tình trạng vật lý, trạng thái lưu thông và mã lượt mượn đang mở (openLoanItemId) nếu sách đang có người mượn.',
    tables: 'book_copies (Read), books (Read), loan_items (Read)',
    fields: 'book_copies.*, books.title, loan_items.id',
    sampleInput: 'Path: barcode=BC-UIT-100201'
  },
  {
    stt: 12,
    category: 'Lưu thông mượn trả',
    name: 'cardByNumber',
    method: 'GET',
    path: '/api/v1/cards/by-number/:cardNumber',
    access: 'Thủ thư (card.manage / loan.checkout)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Quét mã thẻ thư viện tại quầy. Trả về trạng thái thẻ (active, expired, lost), thông tin cá nhân bạn đọc, loại bạn đọc và tài khoản liên kết.',
    tables: 'library_cards (Read), readers (Read), reader_types (Read)',
    fields: 'library_cards.*, readers.*, reader_types.code',
    sampleInput: 'Path: cardNumber=CARD-2026-0001'
  },

  // III. Danh mục & Kho ấn phẩm (14 APIs)
  {
    stt: 13,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'searchCatalog',
    method: 'GET',
    path: '/api/v1/catalog/books',
    access: 'Public',
    procedure: 'Query Drizzle (Search index)',
    workflow: 'Tra cứu danh mục sách công khai. Lọc theo từ khóa tìm kiếm (q), danh mục (categoryId), mã ISBN (identifier), định dạng tài liệu (materialType). Chỉ trả về sách status="active", kèm số lượng bản sao sẵn sàng (available) và tổng bản sao (total).',
    tables: 'books, book_authors, authors, book_categories, categories, book_copies, material_types (Read)',
    fields: 'books.id, title, subtitle, cover_url, published_year; COUNT(book_copies)',
    sampleInput: 'Query: ?q=Co so du lieu&categoryId=2&materialType=BOOK_PRINT&page=1&pageSize=12'
  },
  {
    stt: 14,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'getCatalogBook',
    method: 'GET',
    path: '/api/v1/catalog/books/:bookId',
    access: 'Public',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Xem chi tiết ấn phẩm công khai: tác giả, nhà xuất bản, mô tả, phân loại, các mã định danh ISBN và tổng số bản sao còn trên kệ.',
    tables: 'books, publishers, authors, categories, book_identifiers, book_copies (Read)',
    fields: 'books.*, publishers.name, authors.name, book_identifiers.*',
    sampleInput: 'Path: bookId=1'
  },
  {
    stt: 15,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'listCategories',
    method: 'GET',
    path: '/api/v1/catalog/categories',
    access: 'Public',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Lấy toàn bộ cây danh mục thể loại tài liệu (bao gồm parentId của danh mục cha).',
    tables: 'categories (Read)',
    fields: 'categories.id, name, parent_id',
    sampleInput: 'curl -X GET http://localhost:3000/api/v1/catalog/categories'
  },
  {
    stt: 16,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'createBook',
    method: 'POST',
    path: '/api/v1/books',
    access: 'Thủ thư (catalog.write)',
    procedure: 'Transaction Node.js',
    workflow: 'Tạo mới một đầu sách trong CSDL: chèn bản ghi books, liên kết danh sách tác giả (book_authors theo thứ tự author_order), thể loại (book_categories) và mã ISBN (book_identifiers) trong 1 Transaction.',
    tables: 'books (Insert), book_authors (Insert), book_categories (Insert), book_identifiers (Insert)',
    fields: 'books: title, subtitle, description, published_year, language_code, material_type_id, replacement_cost_vnd, status="active"; book_authors: book_id, author_id, author_order; book_categories: book_id, category_id; book_identifiers: book_id, identifier_type, identifier_value',
    sampleInput: 'Body: {"title": "Lập Trình Web Hiện Đại", "materialType": "BOOK_PRINT", "authorIds": [1], "categoryIds": [2], "replacementCostVnd": 120000, "identifiers": [{"type": "ISBN_13", "value": "9786040123456"}]}'
  },
  {
    stt: 17,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'getBook',
    method: 'GET',
    path: '/api/v1/books/:bookId',
    access: 'Thủ thư (catalog.write)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Xem chi tiết đầu sách dành cho thủ thư (bao gồm sách đã ngưng lưu hành retired và giá đền bù tài liệu).',
    tables: 'books, publishers, authors, categories, book_identifiers (Read)',
    fields: 'books.*, replacement_cost_vnd, status',
    sampleInput: 'Path: bookId=1'
  },
  {
    stt: 18,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'updateBook',
    method: 'PATCH',
    path: '/api/v1/books/:bookId',
    access: 'Thủ thư (catalog.write)',
    procedure: 'Transaction Node.js',
    workflow: 'Cập nhật thông tin đầu sách, thay thế toàn bộ tác giả, thể loại hoặc mã ISBN nếu được truyền vào, hoặc chuyển trạng thái active/retired.',
    tables: 'books (Update), book_authors (Replace), book_categories (Replace), book_identifiers (Replace)',
    fields: 'books: title, subtitle, description, published_year, replacement_cost_vnd, status, updated_at',
    sampleInput: 'Path: bookId=1; Body: {"title": "Lập Trình Web Hiện Đại (Tái Bản)", "replacementCostVnd": 140000}'
  },
  {
    stt: 19,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'listAuthors',
    method: 'GET',
    path: '/api/v1/authors',
    access: 'Thủ thư (catalog.write)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Danh sách tác giả trong hệ thống, hỗ trợ tìm kiếm theo tiền tố tên (LIKE) và phân trang.',
    tables: 'authors (Read)',
    fields: 'authors.id, name',
    sampleInput: 'Query: ?q=Tran&page=1&pageSize=20'
  },
  {
    stt: 20,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'createAuthor',
    method: 'POST',
    path: '/api/v1/authors',
    access: 'Thủ thư (catalog.write)',
    procedure: 'Query Drizzle (INSERT)',
    workflow: 'Thêm mới tác giả vào hệ thống danh mục.',
    tables: 'authors (Insert)',
    fields: 'authors.name',
    sampleInput: 'Body: {"name": "GS. Trần Văn C"}'
  },
  {
    stt: 21,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'listPublishers',
    method: 'GET',
    path: '/api/v1/publishers',
    access: 'Thủ thư (catalog.write)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Danh sách các nhà xuất bản, hỗ trợ tìm kiếm tên.',
    tables: 'publishers (Read)',
    fields: 'publishers.id, name',
    sampleInput: 'Query: ?q=Giao Duc'
  },
  {
    stt: 22,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'createPublisher',
    method: 'POST',
    path: '/api/v1/publishers',
    access: 'Thủ thư (catalog.write)',
    procedure: 'Query Drizzle (INSERT)',
    workflow: 'Thêm mới nhà xuất bản vào hệ thống.',
    tables: 'publishers (Insert)',
    fields: 'publishers.name',
    sampleInput: 'Body: {"name": "NXB Giáo Dục Việt Nam"}'
  },
  {
    stt: 23,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'createCategory',
    method: 'POST',
    path: '/api/v1/categories',
    access: 'Thủ thư (catalog.write)',
    procedure: 'Query Drizzle (INSERT)',
    workflow: 'Tạo mới một thể loại sách, có thể chọn danh mục cha parentId.',
    tables: 'categories (Insert)',
    fields: 'categories.name, parent_id',
    sampleInput: 'Body: {"name": "Trí Tuệ Nhân Tạo", "parentId": 1}'
  },
  {
    stt: 24,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'listCopies',
    method: 'GET',
    path: '/api/v1/books/:bookId/copies',
    access: 'Thủ thư (catalog.write / loan.checkout)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Liệt kê toàn bộ các cuốn sách vật lý (bản sao) của một đầu sách: mã vạch barcode, vị trí kệ shelfCode, tình trạng vật lý và trạng thái lưu thông.',
    tables: 'book_copies (Read)',
    fields: 'book_copies.id, barcode, shelf_code, physical_condition, circulation_status',
    sampleInput: 'Path: bookId=1'
  },
  {
    stt: 25,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'registerCopy',
    method: 'POST',
    path: '/api/v1/books/:bookId/copies',
    access: 'Thủ thư (catalog.write)',
    procedure: 'sp_register_copy(p_book_id, p_barcode, p_shelf_code, p_acquired_at, p_condition, p_user_id)',
    workflow: 'Đăng ký nhập kho bản sao mới. Nếu đầu sách đang có bạn đọc chờ trong hàng đợi đặt trước (waiting), bản sao sẽ tự động được gán giữ chỗ (chuyển sang on_hold); ngược lại trạng thái là available.',
    tables: 'book_copies (Insert), reservations (Update nếu khớp giữ chỗ)',
    fields: 'book_copies: book_id, barcode, shelf_code, acquired_at, physical_condition, circulation_status, created_at, updated_at',
    sampleInput: 'Path: bookId=1; Body: {"barcode": "BC-UIT-998877", "shelfCode": "KE-AI-01", "condition": "good"}'
  },
  {
    stt: 26,
    category: 'Danh mục & Kho ấn phẩm',
    name: 'changeCopyStatus',
    method: 'POST',
    path: '/api/v1/copies/:copyId/status',
    access: 'Thủ thư (catalog.write)',
    procedure: 'sp_change_copy_status(p_copy_id, p_target_status, p_condition, p_user_id)',
    workflow: 'Cập nhật trạng thái bảo trì bản sao: chuyển sang sửa chữa (in_repair), đã sửa xong (available), tìm thấy sách (available) hoặc thanh lý loại bỏ (retired).',
    tables: 'book_copies (Update)',
    fields: 'book_copies: circulation_status, physical_condition, updated_at',
    sampleInput: 'Path: copyId=15; Body: {"targetStatus": "in_repair", "condition": "damaged"}'
  },

  // IV. Quản lý bạn đọc, thẻ & chính sách (15 APIs)
  {
    stt: 27,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'listReaders',
    method: 'GET',
    path: '/api/v1/readers',
    access: 'Thủ thư (card.manage / loan.checkout)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Tìm kiếm và lọc danh sách bạn đọc theo từ khóa tên, email, loại bạn đọc (readerType) và trạng thái (status).',
    tables: 'readers (Read), reader_types (Read), library_cards (Read)',
    fields: 'readers.*, reader_types.code, library_cards.*',
    sampleInput: 'Query: ?q=Tran&readerType=UNDERGRADUATE&status=active&page=1&pageSize=20'
  },
  {
    stt: 28,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'createReader',
    method: 'POST',
    path: '/api/v1/readers',
    access: 'Thủ thư (card.manage)',
    procedure: 'Query Drizzle (INSERT)',
    workflow: 'Thêm mới hồ sơ bạn đọc vào cơ sở dữ liệu thư viện.',
    tables: 'readers (Insert)',
    fields: 'readers: full_name, email, phone, reader_type_id, status="active", created_at',
    sampleInput: 'Body: {"fullName": "Nguyễn Thị Mai", "email": "mai.nt@uit.edu.vn", "phone": "0901234567", "readerType": "UNDERGRADUATE"}'
  },
  {
    stt: 29,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'getReader',
    method: 'GET',
    path: '/api/v1/readers/:readerId',
    access: 'Chính chủ hoặc Thủ thư (card.manage / loan.checkout)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Xem thông tin chi tiết một bạn đọc bao gồm loại đối tượng, trạng thái tài khoản và thẻ thư viện đang kích hoạt (activeCard).',
    tables: 'readers (Read), library_cards (Read), reader_types (Read)',
    fields: 'readers.*, library_cards.*',
    sampleInput: 'Path: readerId=1'
  },
  {
    stt: 30,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'updateReader',
    method: 'PATCH',
    path: '/api/v1/readers/:readerId',
    access: 'Thủ thư (card.manage)',
    procedure: 'Query Drizzle (UPDATE)',
    workflow: 'Cập nhật thông tin cá nhân bạn đọc (họ tên, email, sđt) hoặc thay đổi trạng thái (active, suspended, inactive).',
    tables: 'readers (Update)',
    fields: 'readers: full_name, email, phone, reader_type_id, status',
    sampleInput: 'Path: readerId=1; Body: {"phone": "0988776655", "status": "active"}'
  },
  {
    stt: 31,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'linkAccount',
    method: 'PUT',
    path: '/api/v1/readers/:readerId/account',
    access: 'Thủ thư (card.manage)',
    procedure: 'Query Drizzle (UPDATE)',
    workflow: 'Liên kết một tài khoản đăng nhập app_users với hồ sơ bạn đọc readers (quan hệ duy nhất 1-1 qua readers_user_uq).',
    tables: 'readers (Update)',
    fields: 'readers: user_id',
    sampleInput: 'Path: readerId=1; Body: {"accountId": 10}'
  },
  {
    stt: 32,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'unlinkAccount',
    method: 'DELETE',
    path: '/api/v1/readers/:readerId/account',
    access: 'Thủ thư (card.manage)',
    procedure: 'Query Drizzle (UPDATE)',
    workflow: 'Hủy liên kết tài khoản đăng nhập khỏi hồ sơ bạn đọc.',
    tables: 'readers (Update)',
    fields: 'readers: user_id = NULL',
    sampleInput: 'Path: readerId=1'
  },
  {
    stt: 33,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'readerCards',
    method: 'GET',
    path: '/api/v1/readers/:readerId/cards',
    access: 'Chính chủ hoặc Thủ thư (card.manage)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Lấy lịch sử toàn bộ các thẻ thư viện từng phát hành cho bạn đọc, thẻ mới nhất xếp trước.',
    tables: 'library_cards (Read)',
    fields: 'library_cards.*',
    sampleInput: 'Path: readerId=1'
  },
  {
    stt: 34,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'issueCard',
    method: 'POST',
    path: '/api/v1/readers/:readerId/cards',
    access: 'Thủ thư (card.manage)',
    procedure: 'sp_issue_card(p_reader_id, p_card_number, p_expires_at, p_user_id)',
    workflow: 'Phát hành thẻ thư viện mới. Đảm bảo mỗi bạn đọc chỉ có tối đa 1 thẻ trạng thái active tại một thời điểm (ràng buộc qua chỉ mục library_cards_active_reader_uq).',
    tables: 'library_cards (Insert)',
    fields: 'library_cards: reader_id, card_number, issued_at, expires_at, status="active", created_at',
    sampleInput: 'Path: readerId=1; Body: {"cardNumber": "CARD-UIT-2026-99", "expiresAt": "2027-09-30T23:59:59Z"}'
  },
  {
    stt: 35,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'setCardStatus',
    method: 'POST',
    path: '/api/v1/cards/:cardId/status',
    access: 'Thủ thư (card.manage)',
    procedure: 'sp_set_card_status(p_card_id, p_status, p_user_id)',
    workflow: 'Khóa thẻ thư viện: chuyển thẻ active sang expired (hết hạn), lost (báo mất) hoặc revoked (thu hồi vi phạm). Không thể chuyển ngược lại thành active.',
    tables: 'library_cards (Update)',
    fields: 'library_cards: status',
    sampleInput: 'Path: cardId=2; Body: {"status": "lost"}'
  },
  {
    stt: 36,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'readerTypes',
    method: 'GET',
    path: '/api/v1/reference/reader-types',
    access: 'Đã đăng nhập (signed-in)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Lấy danh mục đối tượng độc giả (UNDERGRADUATE, GRADUATE, FACULTY, RESEARCHER, EXTERNAL).',
    tables: 'reader_types (Read)',
    fields: 'reader_types.id, code, name',
    sampleInput: 'curl -X GET http://localhost:3000/api/v1/reference/reader-types'
  },
  {
    stt: 37,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'materialTypes',
    method: 'GET',
    path: '/api/v1/reference/material-types',
    access: 'Đã đăng nhập (signed-in)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Lấy danh mục định dạng tài liệu (BOOK_PRINT, THESIS, JOURNAL, CD_ROM, v.v.).',
    tables: 'material_types (Read)',
    fields: 'material_types.id, code, name',
    sampleInput: 'curl -X GET http://localhost:3000/api/v1/reference/material-types'
  },
  {
    stt: 38,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'listPolicies',
    method: 'GET',
    path: '/api/v1/policies',
    access: 'Thủ thư (policy.manage / loan.checkout)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Danh sách các phiên bản chính sách mượn sách theo đối tượng và loại ấn phẩm, mới nhất xếp trước.',
    tables: 'loan_policies (Read), reader_types (Read), material_types (Read)',
    fields: 'loan_policies.*',
    sampleInput: 'Query: ?readerType=UNDERGRADUATE&materialType=BOOK_PRINT'
  },
  {
    stt: 39,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'createPolicy',
    method: 'POST',
    path: '/api/v1/policies',
    access: 'Quản trị viên (policy.manage)',
    procedure: 'sp_create_policy_version(...)',
    workflow: 'Tạo mới một phiên bản chính sách mượn sách (số lượng tối đa, số ngày mượn, số lần gia hạn, tiền phạt trễ/ngày, ngưỡng nợ khóa thẻ). Kiểm tra tính toàn vẹn thời gian, không cho phép chồng lấn hiệu lực.',
    tables: 'loan_policies (Insert)',
    fields: 'loan_policies: reader_type_id, material_type_id, max_active_items, loan_days, max_renewals, daily_late_fee_vnd, debt_block_threshold_vnd, valid_from, created_by_user_id',
    sampleInput: 'Body: {"readerType": "FACULTY", "materialType": "BOOK_PRINT", "maxActiveItems": 10, "loanDays": 30, "maxRenewals": 3, "dailyLateFeeVnd": 5000, "debtBlockThresholdVnd": 100000, "validFrom": "2026-10-01T00:00:00Z"}'
  },
  {
    stt: 40,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'closePolicy',
    method: 'POST',
    path: '/api/v1/policies/:policyId/close',
    access: 'Quản trị viên (policy.manage)',
    procedure: 'sp_close_policy_version(p_policy_id, p_valid_to, p_user_id)',
    workflow: 'Đóng hiệu lực của một chính sách mượn sách tại thời điểm validTo.',
    tables: 'loan_policies (Update)',
    fields: 'loan_policies: valid_to',
    sampleInput: 'Path: policyId=2; Body: {"validTo": "2026-09-30T23:59:59Z"}'
  },
  {
    stt: 41,
    category: 'Bạn đọc, Thẻ & Chính sách',
    name: 'expireCards',
    method: 'POST',
    path: '/api/v1/jobs/expire-cards',
    access: 'Thủ thư (card.manage)',
    procedure: 'sp_expire_cards(p_user_id)',
    workflow: 'Tác vụ định kỳ quét và cập nhật trạng thái expired cho toàn bộ các thẻ thư viện có expires_at < NOW().',
    tables: 'library_cards (Update)',
    fields: 'library_cards: status="expired"',
    sampleInput: 'Body: {}'
  },

  // V. Quản lý tài chính & Tiền phạt (5 APIs)
  {
    stt: 42,
    category: 'Tài chính & Tiền phạt',
    name: 'readerFines',
    method: 'GET',
    path: '/api/v1/readers/:readerId/fines',
    access: 'Chính chủ hoặc Thủ thư (fine.collect)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Lấy danh sách các khoản phạt của bạn đọc (trễ hạn, làm hỏng, mất sách). Cho phép lọc open=true để chỉ lấy các khoản còn nợ.',
    tables: 'fines (Read), loan_items (Read), books (Read), fine_adjustments (Read), fine_payment_allocations (Read)',
    fields: 'fines.*, books.title, loan_items.borrowed_at; tính toán remainingVnd',
    sampleInput: 'Path: readerId=1; Query: ?open=true'
  },
  {
    stt: 43,
    category: 'Tài chính & Tiền phạt',
    name: 'readerBalance',
    method: 'GET',
    path: '/api/v1/readers/:readerId/balance',
    access: 'Chính chủ hoặc Thủ thư (fine.collect / loan.checkout)',
    procedure: 'Query Drizzle (Aggregate)',
    workflow: 'Tính toán tổng số nợ phạt hiện tại của bạn đọc (Tổng phạt phát sinh - Miễn giảm điều chỉnh - Đã thanh toán).',
    tables: 'fines (Read), fine_adjustments (Read), fine_payment_allocations (Read)',
    fields: 'Tổng hợp số dư nợ outstandingVnd',
    sampleInput: 'Path: readerId=1'
  },
  {
    stt: 44,
    category: 'Tài chính & Tiền phạt',
    name: 'readerPayments',
    method: 'GET',
    path: '/api/v1/readers/:readerId/payments',
    access: 'Chính chủ hoặc Thủ thư (fine.collect)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Lịch sử các lần đóng tiền phạt của bạn đọc kèm thông tin người thu và danh sách phân bổ cho từng khoản phạt.',
    tables: 'fine_payments (Read), fine_payment_allocations (Read)',
    fields: 'fine_payments.*, fine_payment_allocations.*',
    sampleInput: 'Path: readerId=1'
  },
  {
    stt: 45,
    category: 'Tài chính & Tiền phạt',
    name: 'recordPayment',
    method: 'POST',
    path: '/api/v1/payments',
    access: 'Thủ thư thu phí (fine.collect)',
    procedure: 'sp_record_payment(...)',
    workflow: 'Thu tiền phạt (tiền mặt / chuyển khoản). Phải phân bổ chính xác số tiền cho từng khoản phạt còn nợ (allocations). Đảm bảo tính Idempotent bằng requestKey (gửi lại cùng key trả kết quả replayed: true thay vì trừ 2 lần).',
    tables: 'fine_payments (Insert), fine_payment_allocations (Insert)',
    fields: 'fine_payments: reader_id, received_by_user_id, amount_vnd, paid_at, method, reference_no, request_key, created_at; fine_payment_allocations: payment_id, fine_id, amount_vnd',
    sampleInput: 'Body: {"readerId": 1, "amountVnd": 30000, "method": "cash", "requestKey": "c3b53f60-5f21-4f2e-b6c8-111122223333", "allocations": [{"fineId": 2, "amountVnd": 30000}]}'
  },
  {
    stt: 46,
    category: 'Tài chính & Tiền phạt',
    name: 'adjustFine',
    method: 'POST',
    path: '/api/v1/fines/:fineId/adjustments',
    access: 'Quản trị viên (fine.adjust)',
    procedure: 'sp_adjust_fine(p_fine_id, p_amount_vnd, p_reason, p_user_id)',
    workflow: 'Điều chỉnh số tiền phạt (miễn giảm tiền phạt có dấu âm). Yêu cầu bắt buộc phải có lý do điều chỉnh.',
    tables: 'fine_adjustments (Insert)',
    fields: 'fine_adjustments: fine_id, amount_vnd, reason, adjusted_by_user_id, adjusted_at',
    sampleInput: 'Path: fineId=2; Body: {"amountVnd": -10000, "reason": "Miễn giảm theo quyết định của Ban Giám hiệu"}'
  },

  // VI. Đặt trước & Giữ chỗ ấn phẩm (5 APIs)
  {
    stt: 47,
    category: 'Đặt trước & Giữ chỗ',
    name: 'reserve',
    method: 'POST',
    path: '/api/v1/reservations',
    access: 'Bạn đọc / Thủ thư (reservation.manage)',
    procedure: 'sp_reserve(p_reader_id, p_book_id, p_user_id)',
    workflow: 'Đặt trước đầu sách khi toàn bộ bản sao đang được mượn hoặc không sẵn có. Kiểm tra: bạn đọc không nợ quá hạn, chưa mượn cuốn này, và chưa đặt trước cùng đầu sách (reservations_active_uq). Trạng thái ban đầu là waiting.',
    tables: 'reservations (Insert)',
    fields: 'reservations: reader_id, book_id, requested_at, status="waiting"',
    sampleInput: 'Body: {"readerId": 1, "bookId": 3}'
  },
  {
    stt: 48,
    category: 'Đặt trước & Giữ chỗ',
    name: 'cancelReservation',
    method: 'POST',
    path: '/api/v1/reservations/:reservationId/cancel',
    access: 'Bạn đọc / Thủ thư (reservation.manage)',
    procedure: 'sp_cancel_reservation(p_reservation_id, p_reason, p_user_id)',
    workflow: 'Hủy yêu cầu đặt trước sách. Nếu lượt đặt đang ở trạng thái ready (sách đang giữ trên kệ chờ lấy), bản sao sẽ được chuyển giao tiếp cho người tiếp theo trong hàng đợi hoặc chuyển thành available.',
    tables: 'reservations (Update), book_copies (Update nếu đang giữ sách)',
    fields: 'reservations: status="cancelled", closed_at, close_reason, closed_by_kind, closed_by_user_id',
    sampleInput: 'Path: reservationId=2; Body: {"reason": "Đã mua sách ngoài hiệu sách"}'
  },
  {
    stt: 49,
    category: 'Đặt trước & Giữ chỗ',
    name: 'readerReservations',
    method: 'GET',
    path: '/api/v1/readers/:readerId/reservations',
    access: 'Chính chủ hoặc Thủ thư (reservation.manage)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Danh sách các lượt đặt giữ chỗ của bạn đọc, vị trí trong hàng đợi (queuePosition) và thời hạn giữ sách (holdExpiresAt).',
    tables: 'reservations (Read), books (Read)',
    fields: 'reservations.*, books.title',
    sampleInput: 'Path: readerId=1; Query: ?status=waiting'
  },
  {
    stt: 50,
    category: 'Đặt trước & Giữ chỗ',
    name: 'listReservations',
    method: 'GET',
    path: '/api/v1/reservations',
    access: 'Thủ thư (reservation.manage)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Quản lý toàn bộ hàng đợi đặt trước của thư viện, lọc theo trạng thái (waiting, ready, fulfilled, cancelled, expired).',
    tables: 'reservations (Read), books (Read), readers (Read)',
    fields: 'reservations.*, books.title, readers.full_name',
    sampleInput: 'Query: ?status=ready&page=1&pageSize=20'
  },
  {
    stt: 51,
    category: 'Đặt trước & Giữ chỗ',
    name: 'expireHolds',
    method: 'POST',
    path: '/api/v1/jobs/expire-holds',
    access: 'Thủ thư (reservation.manage)',
    procedure: 'sp_expire_holds(p_user_id)',
    workflow: 'Tác vụ định kỳ kiểm tra và hết hạn các lượt giữ chỗ quá hạn nhận sách (holdExpiresAt < NOW()), tự động chuyển sách cho người tiếp theo.',
    tables: 'reservations (Update), book_copies (Update)',
    fields: 'reservations: status="expired", closed_at, close_reason="HOLD_EXPIRED"',
    sampleInput: 'Body: {}'
  },

  // VII. Báo cáo & Kiểm toán CSDL (7 APIs)
  {
    stt: 52,
    category: 'Báo cáo & Kiểm toán CSDL',
    name: 'reportCumulative',
    method: 'GET',
    path: '/api/v1/reports/debt/cumulative',
    access: 'Báo cáo (report.read)',
    procedure: 'sp_report_cumulative(p_as_of, p_reader_id)',
    workflow: 'Báo cáo công nợ tích lũy tại thời điểm asOf. Kiểm toán đẳng thức tài chính: netAssessedVnd = collectedVnd + outstandingVnd.',
    tables: 'fines, fine_adjustments, fine_payments, fine_payment_allocations (Read)',
    fields: 'netAssessedVnd, collectedVnd, outstandingVnd',
    sampleInput: 'Query: ?asOf=2026-09-25T15:00:00Z'
  },
  {
    stt: 53,
    category: 'Báo cáo & Kiểm toán CSDL',
    name: 'reportRollforward',
    method: 'GET',
    path: '/api/v1/reports/debt/rollforward',
    access: 'Báo cáo (report.read)',
    procedure: 'sp_report_rollforward(p_month, p_reader_id)',
    workflow: 'Báo cáo luân chuyển nợ phạt theo tháng. Kiểm toán chặt chẽ: Nợ cuối kỳ = Nợ đầu kỳ + Phát sinh + Điều chỉnh - Đã thu.',
    tables: 'fines, fine_adjustments, fine_payments, fine_payment_allocations (Read)',
    fields: 'openingOutstandingVnd, assessedInPeriodVnd, adjustedInPeriodVnd, collectedInPeriodVnd, closingOutstandingVnd',
    sampleInput: 'Query: ?month=2026-09'
  },
  {
    stt: 54,
    category: 'Báo cáo & Kiểm toán CSDL',
    name: 'reportOverdue',
    method: 'GET',
    path: '/api/v1/reports/overdue',
    access: 'Báo cáo (report.read)',
    procedure: 'View: v_report_overdue',
    workflow: 'Danh sách các ấn phẩm mượn quá hạn, sắp xếp trễ nhiều ngày nhất lên đầu, phục vụ công tác nhắc nhở thu hồi sách.',
    tables: 'loan_items, loans, readers, books, book_copies (Read)',
    fields: 'readerId, fullName, title, barcode, dueAt, daysLate',
    sampleInput: 'Query: ?page=1&pageSize=50'
  },
  {
    stt: 55,
    category: 'Báo cáo & Kiểm toán CSDL',
    name: 'reportLoansByMonth',
    method: 'GET',
    path: '/api/v1/reports/loans-by-month',
    access: 'Báo cáo (report.read)',
    procedure: 'View: v_report_loans_by_month',
    workflow: 'Thống kê tần suất mượn sách theo từng tháng và theo nhóm đối tượng độc giả.',
    tables: 'loans, loan_items, readers, reader_types (Read)',
    fields: 'monthLocal, readerType, loans, items',
    sampleInput: 'Query: ?fromMonth=2026-01&toMonth=2026-12'
  },
  {
    stt: 56,
    category: 'Báo cáo & Kiểm toán CSDL',
    name: 'reportPopularBooks',
    method: 'GET',
    path: '/api/v1/reports/popular-books',
    access: 'Báo cáo (report.read)',
    procedure: 'View: v_report_popular_books',
    workflow: 'Thống kê Top N cuốn sách có số lượt mượn nhiều nhất trong toàn hệ thống thư viện.',
    tables: 'loan_items, book_copies, books (Read)',
    fields: 'bookId, title, loanItems',
    sampleInput: 'Query: ?limit=10'
  },
  {
    stt: 57,
    category: 'Báo cáo & Kiểm toán CSDL',
    name: 'reportCopyStatus',
    method: 'GET',
    path: '/api/v1/reports/copy-status',
    access: 'Báo cáo (report.read)',
    procedure: 'View: v_report_copy_status',
    workflow: 'Báo cáo hiện trạng các bản sao của từng đầu sách: available, onLoan, onHold, inRepair, lost, retired. Tổng 6 trạng thái bằng total.',
    tables: 'book_copies, books (Read)',
    fields: 'bookId, title, available, onLoan, onHold, inRepair, lost, retired, total',
    sampleInput: 'Query: ?page=1&pageSize=20'
  },
  {
    stt: 58,
    category: 'Báo cáo & Kiểm toán CSDL',
    name: 'adminHealth',
    method: 'GET',
    path: '/api/v1/admin/health',
    access: 'Báo cáo (report.read)',
    procedure: 'Views: v_inv_*',
    workflow: 'Kiểm tra toàn bộ các view bất biến (Invariants) của CSDL. Nếu có bất kỳ vi phạm nào, trả về danh sách view và các dòng dữ liệu sai lệch.',
    tables: 'Toàn bộ các view v_inv_* (Read)',
    fields: 'views: string[], violations: {view, rows}[]',
    sampleInput: 'curl -X GET http://localhost:3000/api/v1/admin/health'
  },

  // VIII. Quản trị tài khoản & Phân quyền (5 APIs)
  {
    stt: 59,
    category: 'Quản trị tài khoản & Vai trò',
    name: 'listAccounts',
    method: 'GET',
    path: '/api/v1/accounts',
    access: 'Quản trị viên (role.manage)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Danh sách các tài khoản người dùng app_users, hỗ trợ lọc theo vai trò (role) và trạng thái (active, inactive).',
    tables: 'app_users, user_roles, roles, readers (Read)',
    fields: 'app_users.id, status, createdAt, roles, readerId, subject',
    sampleInput: 'Query: ?status=active&role=librarian&page=1&pageSize=20'
  },
  {
    stt: 60,
    category: 'Quản trị tài khoản & Vai trò',
    name: 'getAccount',
    method: 'GET',
    path: '/api/v1/accounts/:accountId',
    access: 'Quản trị viên (role.manage)',
    procedure: 'Query Drizzle (SELECT)',
    workflow: 'Xem chi tiết một tài khoản người dùng, danh sách các vai trò đang giữ và mã bạn đọc liên kết.',
    tables: 'app_users, user_roles, roles, readers (Read)',
    fields: 'app_users.*, user_roles.*',
    sampleInput: 'Path: accountId=2'
  },
  {
    stt: 61,
    category: 'Quản trị tài khoản & Vai trò',
    name: 'assignRole',
    method: 'PUT',
    path: '/api/v1/accounts/:accountId/roles/:roleCode',
    access: 'Quản trị viên (role.manage)',
    procedure: 'Query Drizzle (INSERT IGNORE)',
    workflow: 'Gán vai trò cho tài khoản (admin, librarian, reader). Tính chất Idempotent: trả về 204 nếu tài khoản đã có vai trò.',
    tables: 'user_roles (Insert)',
    fields: 'user_roles: user_id, role_id',
    sampleInput: 'Path: accountId=3, roleCode=librarian'
  },
  {
    stt: 62,
    category: 'Quản trị tài khoản & Vai trò',
    name: 'removeRole',
    method: 'DELETE',
    path: '/api/v1/accounts/:accountId/roles/:roleCode',
    access: 'Quản trị viên (role.manage)',
    procedure: 'Query Drizzle (DELETE)',
    workflow: 'Thu hồi vai trò khỏi tài khoản. Ngăn chặn admin tự xóa vai trò admin của chính mình.',
    tables: 'user_roles (Delete)',
    fields: 'user_roles (Xóa bản ghi)',
    sampleInput: 'Path: accountId=3, roleCode=librarian'
  },
  {
    stt: 63,
    category: 'Quản trị tài khoản & Vai trò',
    name: 'setAccountStatus',
    method: 'POST',
    path: '/api/v1/accounts/:accountId/status',
    access: 'Quản trị viên (role.manage)',
    procedure: 'Query Drizzle (UPDATE)',
    workflow: 'Khóa hoặc kích hoạt tài khoản (active / inactive). Tài khoản inactive không thể gọi bất kỳ API nào ngoại trừ GET /me. Admin không thể tự khóa chính mình.',
    tables: 'app_users (Update)',
    fields: 'app_users: status',
    sampleInput: 'Path: accountId=3; Body: {"status": "inactive"}'
  }
];

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateExcelXml(apiList) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Title>Danh Sách Toàn Bộ API Hệ Thống NexusLib UIT</Title>
  <Author>NexusLib System</Author>
  <Created>${new Date().toISOString()}</Created>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Borders/>
   <Font ss:FontName="Roboto" ss:Size="11" ss:Color="#000000"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Roboto" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1E40AF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Cell">
   <Alignment ss:Vertical="Top" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Font ss:FontName="Roboto" ss:Size="10" ss:Color="#1E293B"/>
  </Style>
  <Style ss:ID="CellCenter">
   <Alignment ss:Horizontal="Center" ss:Vertical="Top"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Font ss:FontName="Roboto" ss:Size="10" ss:Color="#1E293B"/>
  </Style>
  <Style ss:ID="CellMethodGET">
   <Alignment ss:Horizontal="Center" ss:Vertical="Top"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Font ss:FontName="Roboto Mono" ss:Size="10" ss:Bold="1" ss:Color="#047857"/>
   <Interior ss:Color="#ECFDF5" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="CellMethodPOST">
   <Alignment ss:Horizontal="Center" ss:Vertical="Top"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Font ss:FontName="Roboto Mono" ss:Size="10" ss:Bold="1" ss:Color="#1D4ED8"/>
   <Interior ss:Color="#EFF6FF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="CellMethodPATCH">
   <Alignment ss:Horizontal="Center" ss:Vertical="Top"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Font ss:FontName="Roboto Mono" ss:Size="10" ss:Bold="1" ss:Color="#B45309"/>
   <Interior ss:Color="#FFFBEB" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="CellMethodPUT">
   <Alignment ss:Horizontal="Center" ss:Vertical="Top"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Font ss:FontName="Roboto Mono" ss:Size="10" ss:Bold="1" ss:Color="#6D28D9"/>
   <Interior ss:Color="#F5F3FF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="CellMethodDELETE">
   <Alignment ss:Horizontal="Center" ss:Vertical="Top"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Font ss:FontName="Roboto Mono" ss:Size="10" ss:Bold="1" ss:Color="#B91C1C"/>
   <Interior ss:Color="#FEF2F2" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="CellMono">
   <Alignment ss:Vertical="Top" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Font ss:FontName="Roboto Mono" ss:Size="9" ss:Color="#0F172A"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Danh_Sach_63_API">
  <Table ss:ExpandedColumnCount="11" x:FullColumns="1" x:FullRows="1">
   <Column ss:Width="35"/>
   <Column ss:Width="130"/>
   <Column ss:Width="110"/>
   <Column ss:Width="60"/>
   <Column ss:Width="180"/>
   <Column ss:Width="130"/>
   <Column ss:Width="170"/>
   <Column ss:Width="260"/>
   <Column ss:Width="190"/>
   <Column ss:Width="210"/>
   <Column ss:Width="260"/>
   <Row ss:Height="28">
    <Cell ss:StyleID="Header"><Data ss:Type="String">STT</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Phân Hệ Nghiệp Vụ</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Tên API (Contract)</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Method</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Đường Dẫn Endpoint</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Quyền Hạn (Access)</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Stored Procedure / View</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Cách Hoạt Động &amp; Quy Trình</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Bảng CSDL Ảnh Hưởng</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Các Trường (Fields) Ảnh Hưởng</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Dữ Liệu Test Mẫu (Input)</Data></Cell>
   </Row>
   ${apiList
     .map((a) => {
       const methodStyle =
         a.method === 'GET'
           ? 'CellMethodGET'
           : a.method === 'POST'
           ? 'CellMethodPOST'
           : a.method === 'PATCH'
           ? 'CellMethodPATCH'
           : a.method === 'PUT'
           ? 'CellMethodPUT'
           : 'CellMethodDELETE';
       return `
   <Row ss:AutoFitHeight="1">
    <Cell ss:StyleID="CellCenter"><Data ss:Type="Number">${a.stt}</Data></Cell>
    <Cell ss:StyleID="Cell"><Data ss:Type="String">${escapeXml(a.category)}</Data></Cell>
    <Cell ss:StyleID="CellMono"><Data ss:Type="String">${escapeXml(a.name)}</Data></Cell>
    <Cell ss:StyleID="${methodStyle}"><Data ss:Type="String">${escapeXml(a.method)}</Data></Cell>
    <Cell ss:StyleID="CellMono"><Data ss:Type="String">${escapeXml(a.path)}</Data></Cell>
    <Cell ss:StyleID="Cell"><Data ss:Type="String">${escapeXml(a.access)}</Data></Cell>
    <Cell ss:StyleID="CellMono"><Data ss:Type="String">${escapeXml(a.procedure)}</Data></Cell>
    <Cell ss:StyleID="Cell"><Data ss:Type="String">${escapeXml(a.workflow)}</Data></Cell>
    <Cell ss:StyleID="Cell"><Data ss:Type="String">${escapeXml(a.tables)}</Data></Cell>
    <Cell ss:StyleID="Cell"><Data ss:Type="String">${escapeXml(a.fields)}</Data></Cell>
    <Cell ss:StyleID="CellMono"><Data ss:Type="String">${escapeXml(a.sampleInput)}</Data></Cell>
   </Row>`;
     })
     .join('')}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/>
   <FrozenNoSplit/>
   <SplitHorizontal>1</SplitHorizontal>
   <TopRowBottomPane>1</TopRowBottomPane>
   <ActivePane>2</ActivePane>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

function generateCsv(apiList) {
  const headers = [
    'STT',
    'Phân Hệ Nghiệp Vụ',
    'Tên API (Contract)',
    'Method',
    'Đường Dẫn Endpoint',
    'Quyền Hạn (Access)',
    'Stored Procedure / View',
    'Cách Hoạt Động & Quy Trình',
    'Bảng CSDL Ảnh Hưởng',
    'Các Trường (Fields) Ảnh Hưởng',
    'Dữ Liệu Test Mẫu (Input)'
  ];

  const escapeCsv = (str) => {
    if (!str) return '""';
    const clean = String(str).replace(/"/g, '""');
    return `"${clean}"`;
  };

  const rows = apiList.map((a) =>
    [
      a.stt,
      escapeCsv(a.category),
      escapeCsv(a.name),
      escapeCsv(a.method),
      escapeCsv(a.path),
      escapeCsv(a.access),
      escapeCsv(a.procedure),
      escapeCsv(a.workflow),
      escapeCsv(a.tables),
      escapeCsv(a.fields),
      escapeCsv(a.sampleInput)
    ].join(',')
  );

  // UTF-8 BOM \uFEFF for proper Vietnamese display in Excel
  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
}

// Generate files
const docsDir = path.resolve(process.cwd(), 'docs');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

const xmlPath = path.join(docsDir, 'uitlib_api_documentation.xls');
fs.writeFileSync(xmlPath, generateExcelXml(apis), 'utf-8');
console.log(`Created Excel XML at: ${xmlPath}`);

const csvPath = path.join(docsDir, 'uitlib_api_documentation.csv');
fs.writeFileSync(csvPath, generateCsv(apis), 'utf-8');
console.log(`Created CSV at: ${csvPath}`);
