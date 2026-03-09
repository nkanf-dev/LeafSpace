import React from 'react';
import type { HeldPage } from '../../types/domain';
import '../../styles/HeldPagesPanel.css';

interface Props {
  pages: HeldPage[];
  onPageClick: (page: HeldPage) => void;
  onRemovePage: (id: string) => void;
}

/**
 * HeldPagesPanel (夹页面板)
 * 职责：展示已收藏/夹住的页面，支持快速跳转。
 */
export const HeldPagesPanel: React.FC<Props> = ({ pages, onPageClick, onRemovePage }) => {
  return (
    <div className="held-pages-panel">
      <h3 className="panel-title">Held Pages</h3>
      <div className="held-pages-list">
        {pages.length === 0 ? (
          <p className="empty-state">No held pages</p>
        ) : (
          pages.map(page => (
            <div 
              key={page.id} 
              className={`held-page-item ${page.isOpen ? 'active' : ''}`}
              onClick={() => onPageClick(page)}
            >
              <div className="held-page-info">
                <span className="page-number">P. {page.pageNumber}</span>
                <span className="page-name">{page.customName || page.defaultName}</span>
              </div>
              <button 
                className="remove-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemovePage(page.id);
                }}
              >
                &times;
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
