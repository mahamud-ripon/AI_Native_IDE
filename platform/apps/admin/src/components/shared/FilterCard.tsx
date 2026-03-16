/**
 * Shared FilterCard Component
 * 
 * Reusable filter bar structure with search input and filter slots.
 */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui';

interface FilterOption {
  value: string;
  label: string;
}

interface FilterCardProps {
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filters?: {
    name: string;
    value: string;
    options: FilterOption[];
    onChange: (value: string) => void;
  }[];
  actions?: React.ReactNode;
}

export function FilterCard({
  searchPlaceholder = 'Search...',
  searchValue = '',
  onSearchChange,
  filters,
  actions,
}: FilterCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.elements.namedItem('search') as HTMLInputElement;
    
    const params = new URLSearchParams(searchParams);
    if (input.value.trim()) {
      params.set('search', input.value.trim());
    } else {
      params.delete('search');
    }
    params.delete('page');
    router.push(`?${params.toString()}`);
  };

  const handleClearSearch = () => {
    if (onSearchChange) {
      onSearchChange('');
    }
    const params = new URLSearchParams(searchParams);
    params.delete('search');
    params.delete('page');
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <input
            type="text"
            name="search"
            defaultValue={searchValue}
            placeholder={searchPlaceholder}
            className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
          {searchValue && (
            <Button type="button" variant="ghost" size="sm" onClick={handleClearSearch}>
              Clear
            </Button>
          )}
        </form>

        {/* Filters */}
        {filters && filters.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {filters.map((filter) => (
              <select
                key={filter.name}
                value={filter.value}
                onChange={(e) => filter.onChange(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ))}
          </div>
        )}

        {/* Actions */}
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
