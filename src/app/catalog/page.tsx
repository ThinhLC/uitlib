'use client';

import { useEffect, useState, useCallback } from 'react';
import { BookSummary, Category, endpoints } from '@/lib/api/contract';
import { apiFetch } from '@/lib/api/client';
import { BookCard } from '@/components/catalog/book-card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Loader2, BookOpen } from 'lucide-react';
import debounce from 'lodash-es/debounce';

export default function CatalogPage() {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(12);
  const [loading, setLoading] = useState(true);

  // Load categories once
  useEffect(() => {
    apiFetch(endpoints.listCategories, {})
      .then((res) => setCategories(res.items))
      .catch((err) => console.error('Failed to load categories', err));
  }, []);

  // Fetch books query
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

  const totalPages = Math.ceil(total / pageSize);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header section */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          Tra Cứu Danh Mục Sách
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Tìm kiếm sách, kiểm tra tình trạng còn sách trên kệ và khám phá tài liệu học tập.
        </p>
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
