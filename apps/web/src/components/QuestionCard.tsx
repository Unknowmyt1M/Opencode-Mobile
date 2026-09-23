import React, { useState } from 'react';
import {
  HelpCircle,
  CheckCircle2,
  Send,
  Loader2,
  Circle,
  CheckSquare2,
  Square,
  Sparkles,
} from 'lucide-react';

interface QuestionOption {
  label: string;
  description?: string;
}

interface QuestionItem {
  question: string;
  options?: (string | QuestionOption)[];
  multiple?: boolean;
}

interface QuestionCardProps {
  input: any;
  output?: any;
  status?: string;
  requestId?: string;
  onReply?: (answers: string[][]) => Promise<any> | any;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({
  input,
  output,
  status = 'pending',
  requestId: _requestId,
  onReply,
}) => {
  // Normalize questions array
  const rawQuestions: QuestionItem[] = Array.isArray(input?.questions)
    ? input.questions
    : input?.question
    ? [
        {
          question: input.question,
          options: input.options,
          multiple: input.multiple,
        },
      ]
    : [];

  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string[]>>({});
  const [customInput, setCustomInput] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isCompleted = status === 'completed' || Boolean(output);

  if (rawQuestions.length === 0) {
    return null;
  }

  const handleSelectOption = (qIdx: number, optLabel: string, isMultiple = false) => {
    if (isCompleted) return;
    setSelectedAnswers((prev) => {
      const current = prev[qIdx] || [];
      if (isMultiple) {
        const next = current.includes(optLabel)
          ? current.filter((l) => l !== optLabel)
          : [...current, optLabel];
        return { ...prev, [qIdx]: next };
      } else {
        return { ...prev, [qIdx]: [optLabel] };
      }
    });
  };

  const handleSubmit = async () => {
    if (!onReply || isSubmitting) return;

    // Collect answers
    const answers: string[][] = rawQuestions.map((_q, idx) => {
      const selected = selectedAnswers[idx] || [];
      const custom = customInput[idx]?.trim();
      if (custom) {
        return [...selected, custom];
      }
      return selected.length > 0 ? selected : ['Skip / No preference'];
    });

    setIsSubmitting(true);
    try {
      await onReply(answers);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full my-2.5 rounded-xl border border-indigo-500/30 bg-slate-900/95 overflow-hidden shadow-lg shadow-indigo-950/20">
      {/* Header */}
      <div className="px-4 py-2.5 bg-indigo-950/30 border-b border-indigo-500/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-indigo-500/20 text-indigo-400">
            <HelpCircle className="w-4 h-4" />
          </div>
          <span className="text-xs font-semibold text-indigo-200">
            {isCompleted ? 'Question Answered' : 'Clarification Needed'}
          </span>
        </div>

        {isCompleted ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            <span>Answered</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
            <Sparkles className="w-3 h-3 animate-pulse" />
            <span>Action Required</span>
          </span>
        )}
      </div>

      {/* Questions list */}
      <div className="p-4 space-y-4">
        {rawQuestions.map((item, qIdx) => {
          const currentPicks = selectedAnswers[qIdx] || [];
          const isMulti = Boolean(item.multiple);

          return (
            <div key={qIdx} className="space-y-2.5">
              <h4 className="text-xs font-semibold text-slate-100 leading-snug">
                {item.question}
              </h4>

              {/* Options */}
              {Array.isArray(item.options) && item.options.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {item.options.map((opt, optIdx) => {
                    const label = typeof opt === 'string' ? opt : opt.label;
                    const description = typeof opt === 'object' ? opt.description : undefined;
                    const isPicked = currentPicks.includes(label);

                    return (
                      <button
                        key={optIdx}
                        type="button"
                        disabled={isCompleted}
                        onClick={() => handleSelectOption(qIdx, label, isMulti)}
                        className={`text-left p-2.5 rounded-lg border transition-all flex items-start gap-2.5 cursor-pointer ${
                          isPicked
                            ? 'bg-indigo-600/20 border-indigo-500 text-slate-100 shadow-sm shadow-indigo-500/20'
                            : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800/80 hover:border-slate-600'
                        } ${isCompleted ? 'cursor-default opacity-85' : ''}`}
                      >
                        <div className="mt-0.5 shrink-0 text-indigo-400">
                          {isMulti ? (
                            isPicked ? (
                              <CheckSquare2 className="w-4 h-4 text-indigo-400" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-500" />
                            )
                          ) : isPicked ? (
                            <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                          ) : (
                            <Circle className="w-4 h-4 text-slate-500" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium leading-tight">{label}</div>
                          {description && (
                            <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                              {description}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Write-in alternative if pending */}
              {!isCompleted && (
                <div className="pt-1">
                  <input
                    type="text"
                    placeholder="Or type a custom answer..."
                    value={customInput[qIdx] || ''}
                    onChange={(e) =>
                      setCustomInput((prev) => ({ ...prev, [qIdx]: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/60 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Submit Button if pending */}
        {!isCompleted && onReply && (
          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold shadow-md shadow-indigo-900/30 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Submit Answer</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
