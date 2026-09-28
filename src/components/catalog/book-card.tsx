'use client';

import Link from 'next/link';
import { BookSummary } from '@/lib/api/contract';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BookOpen, CheckCircle, Clock } from 'lucide-react';

interface BookCardProps {
  book: BookSummary;
}

export function BookCard({ book }: BookCardProps) {
  const isAvailable = book.copies.available > 0;
  const authorsText = book.authors.map((a) => a.name).join(', ') || 'Tác giả chưa cập nhật';
  const materialLabel = book.materialType === 'BOOK_PRINT' ? 'Sách in' : book.materialType;

  return (
    <Link href={`/catalog/${book.id}`} className="group block h-full">
      <Card className="h-full flex flex-col overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-primary/50 group-hover:-translate-y-1">
        {/* Book Cover Area */}
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted/60 flex items-center justify-center border-b">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={book.title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground/80">
              <BookOpen className="h-14 w-14 mb-2 stroke-[1.5] text-primary/40" />
              <span className="text-xs font-semibold uppercase tracking-wider line-clamp-2">
                {book.title}
              </span>
            </div>
          )}

          {/* Availability pill on top right */}
          <div className="absolute top-2.5 right-2.5 shadow-sm">
            <Badge
              variant={isAvailable ? 'default' : 'secondary'}
              className={`text-[11px] font-semibold flex items-center gap-1 backdrop-blur-md ${
                isAvailable
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-amber-500/90 text-white'
              }`}
            >
              {isAvailable ? (
                <>
                  <CheckCircle className="h-3 w-3" />
                  <span>Còn {book.copies.available}/{book.copies.total} cuốn</span>
                </>
              ) : (
                <>
                  <Clock className="h-3 w-3" />
                  <span>Hết sách ({book.copies.total} bản)</span>
                </>
              )}
            </Badge>
          </div>
        </div>

        {/* Content */}
        <CardHeader className="p-4 pb-2">
          <div className="flex flex-wrap gap-1 mb-1.5">
            {book.categories.slice(0, 2).map((cat) => (
              <Badge key={cat.id} variant="outline" className="text-[10px] font-normal py-0">
                {cat.name}
              </Badge>
            ))}
            {book.publishedYear && (
              <span className="text-[10px] text-muted-foreground self-center ml-auto font-mono">
                {book.publishedYear}
              </span>
            )}
          </div>
          <h3 className="font-semibold text-base leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {book.title}
          </h3>
          {book.subtitle && (
            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{book.subtitle}</p>
          )}
        </CardHeader>

        <CardContent className="p-4 pt-0 flex-1">
          <p className="text-xs text-muted-foreground line-clamp-1">{authorsText}</p>
        </CardContent>

        <CardFooter className="p-4 pt-0 text-[11px] text-muted-foreground border-t bg-muted/20 mt-auto flex justify-between items-center">
          <span className="font-mono">{materialLabel}</span>
          <span className="font-medium text-primary group-hover:underline">Chi tiết →</span>
        </CardFooter>
      </Card>
    </Link>
  );
}
