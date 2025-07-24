import React, { useState, useMemo } from 'react';
import { Eye, LayoutGrid, Settings, FileText, Hash } from 'lucide-react';

const TextDiffApp = () => {
  const [text1, setText1] = useState('');
  const [text2, setText2] = useState('');
  const [viewMode, setViewMode] = useState('inline'); // 'inline' or 'sideBySide'
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // Text processing function
  const processText = (text) => {
    if (ignoreWhitespace) {
      return text
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    }
    return text;
  };

  // Advanced diff algorithm - Myers' algorithm inspired
  const computeDiff = (text1, text2) => {
    const words1 = processText(text1).split(/(\s+)/);
    const words2 = processText(text2).split(/(\s+)/);
    
    const originalWords1 = text1.split(/(\s+)/);
    const originalWords2 = text2.split(/(\s+)/);

    const diff = [];
    let i = 0, j = 0;

    while (i < words1.length || j < words2.length) {
      if (i >= words1.length) {
        // Remaining words are additions
        while (j < words2.length) {
          diff.push({ type: 'added', value: originalWords2[j] });
          j++;
        }
      } else if (j >= words2.length) {
        // Remaining words are deletions
        while (i < words1.length) {
          diff.push({ type: 'deleted', value: originalWords1[i] });
          i++;
        }
      } else if (words1[i] === words2[j]) {
        // Words match
        diff.push({ type: 'equal', value: originalWords1[i] });
        i++;
        j++;
      } else {
        // Find the longest common subsequence for this section
        let found = false;
        
        // Look ahead to see if this is just an insertion
        for (let k = j + 1; k < Math.min(j + 5, words2.length); k++) {
          if (words1[i] === words2[k]) {
            // Insert the words between j and k
            for (let l = j; l < k; l++) {
              diff.push({ type: 'added', value: originalWords2[l] });
            }
            j = k;
            found = true;
            break;
          }
        }

        if (!found) {
          // Look ahead to see if this is just a deletion
          for (let k = i + 1; k < Math.min(i + 5, words1.length); k++) {
            if (words1[k] === words2[j]) {
              // Delete the words between i and k
              for (let l = i; l < k; l++) {
                diff.push({ type: 'deleted', value: originalWords1[l] });
              }
              i = k;
              found = true;
              break;
            }
          }
        }

        if (!found) {
          // This is a substitution
          diff.push({ type: 'deleted', value: originalWords1[i] });
          diff.push({ type: 'added', value: originalWords2[j] });
          i++;
          j++;
        }
      }
    }

    return diff;
  };

  const diff = useMemo(() => computeDiff(text1, text2), [text1, text2, ignoreWhitespace]);

  // Statistics
  const stats1 = {
    words: text1.trim() ? text1.trim().split(/\s+/).length : 0,
    characters: text1.length
  };

  const stats2 = {
    words: text2.trim() ? text2.trim().split(/\s+/).length : 0,
    characters: text2.length
  };

  const renderInlineView = () => {
    return (
      <div className="bg-white border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">Inline Comparison</h3>
        <div className="prose max-w-none">
          {diff.map((part, index) => (
            <span key={index} className={
              part.type === 'added' ? 'bg-green-100 text-green-800 font-bold' :
              part.type === 'deleted' ? 'bg-red-100 text-red-800 line-through' :
              'text-gray-700'
            }>
              {part.value}
            </span>
          ))}
        </div>
      </div>
    );
  };

  const renderSideBySideView = () => {
    const leftSide = [];
    const rightSide = [];

    diff.forEach((part, index) => {
      if (part.type === 'equal') {
        leftSide.push(<span key={index} className="text-gray-700">{part.value}</span>);
        rightSide.push(<span key={index} className="text-gray-700">{part.value}</span>);
      } else if (part.type === 'deleted') {
        leftSide.push(<span key={index} className="bg-red-100 text-red-800 line-through">{part.value}</span>);
      } else if (part.type === 'added') {
        rightSide.push(<span key={index} className="bg-green-100 text-green-800 font-bold">{part.value}</span>);
      }
    });

    return (
      <div className="bg-white border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">Side-by-Side Comparison</h3>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h4 className="font-medium text-gray-600 mb-2">Original Text</h4>
            <div className="prose max-w-none border-l-4 border-red-200 pl-4">
              {leftSide}
            </div>
          </div>
          <div>
            <h4 className="font-medium text-gray-600 mb-2">Modified Text</h4>
            <div className="prose max-w-none border-l-4 border-green-200 pl-4">
              {rightSide}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Smart Text Diff Tool</h1>
              <p className="text-gray-600 mt-2">Advanced word-level text comparison with precise change detection</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode(viewMode === 'inline' ? 'sideBySide' : 'inline')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  viewMode === 'inline' 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {viewMode === 'inline' ? <Eye size={16} /> : <LayoutGrid size={16} />}
                {viewMode === 'inline' ? 'Inline' : 'Side-by-Side'}
              </button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
              >
                <Settings size={16} />
                Settings
              </button>
            </div>
          </div>

          {/* Settings Panel */}
          {showSettings && (
            <div className="border-t pt-4">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ignoreWhitespace}
                    onChange={(e) => setIgnoreWhitespace(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Ignore formatting, whitespace, and line breaks</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Text Input Areas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Original Text
            </label>
            <textarea
              value={text1}
              onChange={(e) => setText1(e.target.value)}
              placeholder="Paste your original text here..."
              className="w-full h-48 p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <FileText size={14} />
                {stats1.words} words
              </span>
              <span className="flex items-center gap-1">
                <Hash size={14} />
                {stats1.characters} characters
              </span>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Modified Text
            </label>
            <textarea
              value={text2}
              onChange={(e) => setText2(e.target.value)}
              placeholder="Paste your modified text here..."
              className="w-full h-48 p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <FileText size={14} />
                {stats2.words} words
              </span>
              <span className="flex items-center gap-1">
                <Hash size={14} />
                {stats2.characters} characters
              </span>
            </div>
          </div>
        </div>

        {/* Comparison Results */}
        {(text1 || text2) && (
          <div className="space-y-6">
            {/* Legend */}
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="flex items-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 bg-red-100 border border-red-200 rounded"></span>
                  <span className="text-gray-700">Deleted text</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 bg-green-100 border border-green-200 rounded"></span>
                  <span className="text-gray-700">Added text</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 bg-gray-100 border border-gray-200 rounded"></span>
                  <span className="text-gray-700">Unchanged text</span>
                </div>
              </div>
            </div>

            {/* Comparison View */}
            {viewMode === 'inline' ? renderInlineView() : renderSideBySideView()}
          </div>
        )}

        {/* Empty State */}
        {!text1 && !text2 && (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <div className="text-gray-400 mb-4">
              <FileText size={48} className="mx-auto" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Ready to Compare</h3>
            <p className="text-gray-500">Paste your texts above to see precise, word-level differences</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TextDiffApp;