import React, { useState } from 'react';
import { Document, Thumbnail } from 'react-pdf';
import type { HeldPage } from '../../types/domain';
import { useBookStore } from '../../stores/bookStore';
import { LayoutGrid, List, X } from 'lucide-react';
import '../../styles/HeldPagesPanel.css';

interface Props {
  pages: HeldPage[];
  onPageClick: (page: HeldPage) => void;
  onRemovePage: (id: string) => void;
}

export const HeldPagesPanel: React.FC<Props> = ({ pages, onPageClick, onRemovePage }) => {
  const documentUrl = useBookStore(state => state.documentUrl);
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');

  return (
    <div className={`held-pages-panel kindle-panel view-${viewMode}`}>
      <div className="panel-header-ux">
        <span>夹住的页面 ({pages.length})</span>
        <div className="view-toggle">
          <button className={viewMode === 'card' ? 'active' : ''} onClick={() => setViewMode('card')} title="卡片视图">
            <LayoutGrid size={14} />
          </button>
          <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} title="列表视图">
            <List size={14} />
          </button>
        </div>
      </div>

      <div className="held-pages-list">
        {pages.length === 0 ? (
          <div className="empty-state-ux">✧ 卷轴空空如也</div>
        ) : (
          <Document file={documentUrl}>
            {pages.map(page => (
              <div key={page.id} className={`held-item-ux ${page.isOpen ? 'active' : ''}`} onClick={() => onPageClick(page)}>
                {viewMode === 'card' && (
                  <div className="card-thumb-ux">
                    <Thumbnail pageNumber={page.pageNumber} width={70} loading="..." />
                  </div>
                )}
                <div className="card-content-ux">
                  <div className="card-top-ux">
                    <span className="p-num">P.{page.pageNumber}</span>
                    <button className="del-btn-ux" onClick={(e) => { e.stopPropagation(); onRemovePage(page.id); }} title="移除">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="card-title-ux">{page.customName || page.defaultName}</div>
                </div>
              </div>
            ))}
          </Document>
        )}
      </div>
    </div>
  );
};
