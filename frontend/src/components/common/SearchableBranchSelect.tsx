import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check, X, Lock, Building2 } from 'lucide-react';
import { Branch } from '../../api/operator/types';

export interface SearchableBranchSelectProps {
  branches: Branch[];
  selectedId: string;
  onSelect: (branchId: string) => void;
  disabled?: boolean;
  disabledTooltip?: string;
  placeholder?: string;
  compact?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
  dropdownAlign?: 'left' | 'right';
}

export const SearchableBranchSelect: React.FC<SearchableBranchSelectProps> = ({
  branches,
  selectedId,
  onSelect,
  disabled = false,
  disabledTooltip,
  placeholder = 'Выберите отделение...',
  compact = false,
  className = '',
  id,
  'aria-label': ariaLabel,
  dropdownAlign = 'left',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedBranch = useMemo(() => {
    return branches.find(b => b.id === selectedId);
  }, [branches, selectedId]);

  const filteredBranches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter(b => {
      const anyB = b as { address?: string; code?: string; postalCode?: string; index?: string };
      const nameMatch = b.name.toLowerCase().includes(q);
      const addressMatch = anyB.address?.toLowerCase().includes(q);
      const codeMatch = anyB.code?.toLowerCase().includes(q);
      const postalCodeMatch = anyB.postalCode?.toLowerCase().includes(q);
      const indexMatch = anyB.index?.toLowerCase().includes(q);
      return Boolean(nameMatch || addressMatch || codeMatch || postalCodeMatch || indexMatch);
    });
  }, [branches, searchQuery]);

  // Reset highlight when query changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setHighlightedIndex(0);
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = (branchId: string) => {
    onSelect(branchId);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        if (!disabled) {
          e.preventDefault();
          setIsOpen(true);
        }
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev + 1 < filteredBranches.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev - 1 >= 0 ? prev - 1 : Math.max(0, filteredBranches.length - 1)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredBranches[highlightedIndex]) {
        handleSelect(filteredBranches[highlightedIndex].id);
      }
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
      if (item) {
        item.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  const heightClass = compact ? 'h-9 text-xs px-2.5' : 'h-12 text-sm px-3';

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger Button */}
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(prev => !prev)}
        title={disabled && disabledTooltip ? disabledTooltip : undefined}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel || 'Выбор почтового отделения'}
        className={`w-full rounded-xl border flex items-center justify-between gap-2 text-left font-medium transition-all outline-none ${heightClass} ${
          disabled
            ? 'bg-slate-100/90 text-slate-600 border-slate-200 cursor-not-allowed select-none opacity-85'
            : isOpen
            ? 'bg-white border-[#003B73] ring-2 ring-[#003B73]/20 shadow-xs'
            : 'bg-white text-slate-800 border-slate-300 hover:border-slate-400 hover:bg-slate-50/50 shadow-sm cursor-pointer'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {disabled ? (
            <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
          ) : (
            <Building2 className="w-3.5 h-3.5 text-[#003B73] shrink-0" aria-hidden="true" />
          )}
          <span className="truncate font-sans">
            {selectedBranch ? selectedBranch.name : placeholder}
          </span>
        </div>

        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-[#003B73]' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {/* Dropdown Popover */}
      {isOpen && !disabled && (
        <div
          role="listbox"
          className={`absolute ${dropdownAlign === 'right' ? 'right-0' : 'left-0'} top-full mt-1.5 w-[420px] sm:w-[480px] max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden font-sans`}
          style={{ zIndex: 100 }}
        >
          {/* Search Input Box */}
          <div className="p-2 border-b border-slate-100 bg-slate-50/80">
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 bg-white rounded-xl border border-slate-200 focus-within:border-[#003B73] focus-within:ring-2 focus-within:ring-[#003B73]/20 transition-all"
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <Search
                className="w-3.5 h-3.5 text-slate-400 shrink-0"
                aria-hidden="true"
                style={{ minWidth: '14px', width: '14px', height: '14px' }}
              />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Поиск отделения по названию, адресу или индексу..."
                className="w-full bg-transparent text-xs text-slate-800 placeholder:text-slate-400 outline-none"
                style={{
                  border: 'none',
                  outline: 'none',
                  boxShadow: 'none',
                  padding: 0,
                  margin: 0,
                  height: '24px',
                  lineHeight: '24px',
                  background: 'transparent',
                }}
                aria-label="Поиск отделения"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="p-0.5 text-slate-400 hover:text-slate-600 rounded-md transition-colors shrink-0"
                  title="Очистить"
                  aria-label="Очистить поиск"
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {searchQuery && (
              <div className="px-1 pt-1 text-[10px] text-slate-400 font-mono">
                Найдено отделений: {filteredBranches.length}
              </div>
            )}
          </div>

          {/* Branch List (Exactly 5 items visible, remainder with scrollbar) */}
          <ul
            ref={listRef}
            style={{ maxHeight: '230px', overflowY: 'auto', overscrollBehavior: 'contain' }}
            className="overflow-y-auto py-1 scrollbar-thin divide-y divide-slate-50 overscroll-contain"
          >
            {filteredBranches.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">
                <Search className="w-5 h-5 mx-auto mb-1 text-slate-300" />
                <span>Отделения не найдены</span>
              </li>
            ) : (
              filteredBranches.map((branch, idx) => {
                const isSelected = branch.id === selectedId;
                const isHighlighted = idx === highlightedIndex;
                const anyB = branch as { address?: string; code?: string; postalCode?: string; index?: string };
                const extraInfo = [anyB.code || anyB.postalCode || anyB.index, anyB.address].filter(Boolean).join(' · ');

                return (
                  <li
                    key={branch.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(branch.id)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={`px-3 py-2 text-xs cursor-pointer flex items-center justify-between gap-2 transition-colors ${
                      isSelected
                        ? 'bg-blue-50 text-[#003B73] font-bold'
                        : isHighlighted
                        ? 'bg-slate-100 text-slate-900'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate">{branch.name}</span>
                      {extraInfo && (
                        <span className="text-[10px] text-slate-400 font-normal truncate">
                          {extraInfo}
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-[#003B73] shrink-0" aria-hidden="true" />
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
