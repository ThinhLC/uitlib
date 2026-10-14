'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  BookSummary,
  Category,
  Author,
  Publisher,
  Me,
  endpoints,
} from '@/lib/api/contract';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { BookCard } from '@/components/catalog/book-card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Search,
  Loader2,
  BookOpen,
  Plus,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import debounce from 'lodash-es/debounce';
import type { Session } from '@supabase/supabase-js';

export default function CatalogPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  const [books, setBooks] = useState<BookSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(12);
  const [loading, setLoading] = useState(true);

  // Modal: Thêm đầu sách mới
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // Form fields cho sách mới
  const [newTitle, setNewTitle] = useState('');
  const [newSubtitle, setNewSubtitle] = useState('');
  const [newMaterialType, setNewMaterialType] = useState('BOOK_PRINT');
  const [newClassificationCode, setNewClassificationCode] = useState('QA76.73');
  const [newPublishedYear, setNewPublishedYear] = useState<number>(2026);
  const [newLanguageCode, setNewLanguageCode] = useState('vi');
  const [newReplacementCost, setNewReplacementCost] = useState<number>(100000);
  const [newCoverUrl, setNewCoverUrl] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [selectedAuthorId, setSelectedAuthorId] = useState<number | ''>('');
  const [newAuthorName, setNewAuthorName] = useState('');
  const [selectedPublisherId, setSelectedPublisherId] = useState<number | ''>('');
  const [newPublisherName, setNewPublisherName] = useState('');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [newIsbn, setNewIsbn] = useState('978-604-0-12345-6');

  // Kiểm tra phiên đăng nhập
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session) {
      setMe(null);
      return;
    }
    apiFetch(endpoints.me, {}, { token: session.access_token })
      .then(setMe)
      .catch(() => setMe(null));
  }, [session]);

  const isStaff = useMemo(() => {
    const roles = me?.roles ?? [];
    return roles.includes('librarian') || roles.includes('admin');
  }, [me]);

  // Load danh mục thể loại, tác giả và nhà xuất bản cho form thêm sách
  const loadReferenceData = useCallback(async () => {
    try {
      const [catsRes, authorsRes, pubsRes] = await Promise.all([
        apiFetch(endpoints.listCategories, {}),
        session && isStaff
          ? apiFetch(endpoints.listAuthors, { query: { pageSize: 50 } }, { token: session.access_token }).catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
        session && isStaff
          ? apiFetch(endpoints.listPublishers, { query: { pageSize: 50 } }, { token: session.access_token }).catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
      ]);
      setCategories(catsRes.items);
      if (authorsRes.items.length > 0) setAuthors(authorsRes.items);
      if (pubsRes.items.length > 0) setPublishers(pubsRes.items);
    } catch (err) {
      console.error('Lỗi khi tải danh mục tham chiếu', err);
    }
  }, [session, isStaff]);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  // Tìm kiếm sách
  const fetchBooks = useCallback(async (q: string, categoryId?: number, pageNum: number = 1) => {
    setLoading(true);
    try {
      const res = await apiFetch(endpoints.searchCatalog, {
        query: {
          q: q || undefined,
          categoryId: categoryId || undefined,
          page: pageNum,
          pageSize,
        },
      });
      setBooks(res.items);
      setTotal(res.total);
    } catch (err) {
      console.error('Error fetching catalog books', err);
      setBooks([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  // Debounced search trigger
  const debouncedFetch = useCallback(
    debounce((query: string, catId?: number) => {
      setPage(1);
      fetchBooks(query, catId, 1);
    }, 300),
    [fetchBooks]
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    debouncedFetch(val, selectedCategory);
  };

  const handleCategorySelect = (catId?: number) => {
    setSelectedCategory(catId);
    setPage(1);
    fetchBooks(searchQuery, catId, 1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchBooks(searchQuery, selectedCategory, newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    fetchBooks('', undefined, 1);
  }, [fetchBooks]);

  // Xử lý Thêm đầu sách mới
  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !isStaff) return;
    setCreateLoading(true);
    setCreateError(null);
    setCreateSuccess(null);

    try {
      let authorIds: number[] = [];
      if (selectedAuthorId !== '') {
        authorIds = [Number(selectedAuthorId)];
      } else if (newAuthorName.trim()) {
        const createdAuthor = await apiFetch(
          endpoints.createAuthor,
          { body: { name: newAuthorName.trim() } },
          { token: session.access_token }
        );
        authorIds = [createdAuthor.id];
      }

      if (authorIds.length === 0) {
        setCreateError('Vui lòng chọn tác giả hoặc nhập tên tác giả mới.');
        setCreateLoading(false);
        return;
      }

      let publisherId: number | undefined = undefined;
      if (selectedPublisherId !== '') {
        publisherId = Number(selectedPublisherId);
      } else if (newPublisherName.trim()) {
        const createdPub = await apiFetch(
          endpoints.createPublisher,
          { body: { name: newPublisherName.trim() } },
          { token: session.access_token }
        );
        publisherId = createdPub.id;
      }

      const identifiers = newIsbn.trim()
        ? [{ type: 'ISBN_13' as const, value: newIsbn.trim() }]
        : [];

      await apiFetch(
        endpoints.createBook,
        {
          body: {
            title: newTitle.trim(),
            subtitle: newSubtitle.trim() || undefined,
            description: newDescription.trim() || undefined,
            publishedYear: Number(newPublishedYear) || undefined,
            languageCode: newLanguageCode.trim() || 'vi',
            coverUrl: newCoverUrl.trim() || undefined,
            materialType: newMaterialType as any,
            classificationCode: newClassificationCode.trim() || undefined,
            replacementCostVnd: Number(newReplacementCost) || 100000,
            publisherId,
            authorIds,
            categoryIds: selectedCategoryIds,
            identifiers,
          },
        },
        { token: session.access_token }
      );

      setCreateSuccess(`Đã tạo thành công đầu sách "${newTitle.trim()}"!`);
      // Reset form
      setNewTitle('');
      setNewSubtitle('');
      setNewDescription('');
      setNewAuthorName('');
      setNewPublisherName('');
      setTimeout(() => {
        setIsCreateOpen(false);
        setCreateSuccess(null);
        fetchBooks(searchQuery, selectedCategory, 1);
      }, 1200);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setCreateError(err.message || 'Không thể tạo đầu sách.');
      } else {
        setCreateError('Lỗi máy chủ khi tạo sách.');
      }
    } finally {
      setCreateLoading(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header section */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Tra Cứu Danh Mục Sách
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Tìm kiếm sách, kiểm tra tình trạng còn sách trên kệ và khám phá tài liệu học tập.
          </p>
        </div>

        {/* Nút Thêm sách mới dành cho Thủ thư / Quản trị viên */}
        {isStaff && (
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger render={<Button className="gap-2 shadow-xs shrink-0" />}>
              <Plus className="h-4 w-4" />
              Thêm đầu sách mới
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <form onSubmit={handleCreateBook}>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-primary" />
                    Thêm đầu sách mới vào danh mục
                  </DialogTitle>
                  <DialogDescription>
                    Nhập thông tin tác phẩm (tiêu đề, tác giả, NXB, thể loại, mã ISBN và giá bồi hoàn).
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4 text-xs">
                  {createSuccess && (
                    <div className="p-3 rounded-md bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>{createSuccess}</span>
                    </div>
                  )}

                  {createError && (
                    <div className="p-3 rounded-md bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{createError}</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">
                      Tên đầu sách (Tiêu đề) <span className="text-destructive">*</span>
                    </label>
                    <Input
                      placeholder="VD: Lập Trình TypeScript Hiện Đại..."
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="font-semibold text-foreground">Phụ đề (tùy chọn)</label>
                      <Input
                        placeholder="VD: Từ cơ bản đến nâng cao..."
                        value={newSubtitle}
                        onChange={(e) => setNewSubtitle(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="font-semibold text-foreground">Định dạng tài liệu</label>
                      <select
                        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={newMaterialType}
                        onChange={(e) => setNewMaterialType(e.target.value)}
                      >
                        <option value="BOOK_PRINT">Sách in (BOOK_PRINT)</option>
                        <option value="THESIS">Luận văn (THESIS)</option>
                        <option value="JOURNAL">Tạp chí (JOURNAL)</option>
                        <option value="CD_ROM">Đĩa CD/DVD (CD_ROM)</option>
                        <option value="OTHER">Khác (OTHER)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <label className="font-semibold text-foreground">Ký hiệu phân loại (DDC/LCC)</label>
                      <Input
                        placeholder="VD: QA76.73"
                        value={newClassificationCode}
                        onChange={(e) => setNewClassificationCode(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="font-semibold text-foreground">Năm xuất bản</label>
                      <Input
                        type="number"
                        placeholder="2026"
                        value={newPublishedYear || ''}
                        onChange={(e) => setNewPublishedYear(Number(e.target.value) || 2026)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="font-semibold text-foreground">Giá bồi hoàn (VNĐ)</label>
                      <Input
                        type="number"
                        step="5000"
                        placeholder="100000"
                        value={newReplacementCost || ''}
                        onChange={(e) => setNewReplacementCost(Number(e.target.value) || 0)}
                        required
                      />
                    </div>
                  </div>

                  {/* Tác giả & NXB */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="font-semibold text-foreground">Tác giả</label>
                      {authors.length > 0 ? (
                        <select
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={selectedAuthorId}
                          onChange={(e) => {
                            setSelectedAuthorId(e.target.value ? Number(e.target.value) : '');
                            setNewAuthorName('');
                          }}
                        >
                          <option value="">-- Chọn tác giả có sẵn --</option>
                          {authors.map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      ) : null}
                      <Input
                        placeholder="Hoặc nhập tên tác giả mới..."
                        value={newAuthorName}
                        onChange={(e) => {
                          setNewAuthorName(e.target.value);
                          setSelectedAuthorId('');
                        }}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="font-semibold text-foreground">Nhà xuất bản</label>
                      {publishers.length > 0 ? (
                        <select
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={selectedPublisherId}
                          onChange={(e) => {
                            setSelectedPublisherId(e.target.value ? Number(e.target.value) : '');
                            setNewPublisherName('');
                          }}
                        >
                          <option value="">-- Chọn NXB có sẵn --</option>
                          {publishers.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      ) : null}
                      <Input
                        placeholder="Hoặc nhập tên NXB mới..."
                        value={newPublisherName}
                        onChange={(e) => {
                          setNewPublisherName(e.target.value);
                          setSelectedPublisherId('');
                        }}
                      />
                    </div>
                  </div>

                  {/* Thể loại & ISBN */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="font-semibold text-foreground">Thể loại</label>
                      <select
                        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={selectedCategoryIds[0] || ''}
                        onChange={(e) => setSelectedCategoryIds(e.target.value ? [Number(e.target.value)] : [])}
                      >
                        <option value="">-- Chọn thể loại chính --</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="font-semibold text-foreground">Mã ISBN-13</label>
                      <Input
                        placeholder="VD: 978-604-0-12345-6"
                        value={newIsbn}
                        onChange={(e) => setNewIsbn(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">Đường dẫn ảnh bìa (Cover URL)</label>
                    <Input
                      placeholder="https://images.unsplash.com/..."
                      value={newCoverUrl}
                      onChange={(e) => setNewCoverUrl(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">Mô tả tóm tắt nội dung</label>
                    <textarea
                      rows={3}
                      className="w-full rounded-md border border-input bg-background p-2 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      placeholder="Nội dung giới thiệu cuốn sách..."
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                    />
                  </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateOpen(false)}
                    disabled={createLoading}
                  >
                    Hủy
                  </Button>
                  <Button type="submit" disabled={createLoading}>
                    {createLoading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        Đang tạo sách...
                      </>
                    ) : (
                      'Tạo đầu sách'
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Tìm theo tên sách, tác giả, từ khóa..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="pl-9 pr-4 h-10 w-full rounded-lg"
          />
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 max-w-2xl">
          <Button
            size="sm"
            variant={selectedCategory === undefined ? 'default' : 'outline'}
            onClick={() => handleCategorySelect(undefined)}
            className="rounded-full text-xs h-8"
          >
            Tất cả thể loại
          </Button>
          {categories.slice(0, 6).map((cat) => (
            <Button
              key={cat.id}
              size="sm"
              variant={selectedCategory === cat.id ? 'default' : 'outline'}
              onClick={() => handleCategorySelect(cat.id)}
              className="rounded-full text-xs h-8"
            >
              {cat.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Results Count */}
      <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground font-medium">
        <span>
          Hiển thị {books.length} / {total} đầu sách
        </span>
        {totalPages > 1 && (
          <span>Trang {page} / {totalPages}</span>
        )}
      </div>

      {/* Book Grid */}
      {loading ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">Đang tải danh mục sách...</p>
        </div>
      ) : books.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground/50 mb-3" />
          <h3 className="text-lg font-semibold">Không tìm thấy sách phù hợp</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Không có đầu sách nào khớp với từ khóa tìm kiếm. Bạn hãy thử nhập từ khóa khác hoặc xóa bộ lọc.
          </p>
          {(searchQuery || selectedCategory !== undefined) && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory(undefined);
                fetchBooks('', undefined, 1);
              }}
            >
              Xóa bộ lọc
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 sm:gap-6">
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      )}

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-2 border-t pt-6">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => handlePageChange(page - 1)}
          >
            Trang trước
          </Button>
          <div className="flex items-center gap-1 text-sm font-medium">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Button
                key={p}
                variant={p === page ? 'default' : 'ghost'}
                size="sm"
                className="h-8 w-8 p-0 text-xs"
                onClick={() => handlePageChange(p)}
              >
                {p}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => handlePageChange(page + 1)}
          >
            Trang sau
          </Button>
        </div>
      )}
    </main>
  );
}
