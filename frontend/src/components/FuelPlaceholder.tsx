import { useRef, useCallback } from "react";
import { Flame, ArrowLeft, Clock3 } from "lucide-react";

interface Props {
  onBack: () => void;
  onDevEnter?: () => void;
}

export function FuelPlaceholder({ onBack, onDevEnter }: Props) {
  const clickTimestamps = useRef<number[]>([]);
  const handleIconClick = useCallback(() => {
    if (!onDevEnter) return;
    const now = Date.now();
    clickTimestamps.current = [...clickTimestamps.current.filter(t => now - t < 1500), now];
    if (clickTimestamps.current.length >= 5) {
      clickTimestamps.current = [];
      onDevEnter();
    }
  }, [onDevEnter]);

  return (
    <div className="animate-slideUp">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={onBack} className="p-2 hover:bg-surface-100 dark:hover:bg-dark-700 rounded-xl transition">
          <ArrowLeft className="w-5 h-5 text-dark-600 dark:text-ivory-300" />
        </button>
        <div className="flex items-center gap-2 text-dark-800 dark:text-ivory-200">
          <Flame className="w-4 h-4 text-gold-500" />
          <span className="text-sm font-bold">Түлш худалдаж авах</span>
        </div>
      </div>

      <div className="bg-white dark:bg-dark-800 p-6 rounded-3xl shadow-card border border-silver/60 dark:border-dark-600 flex flex-col items-center gap-5">
        <button type="button" onClick={handleIconClick} className="w-16 h-16 bg-gradient-to-br from-gold-100 to-gold-200 dark:from-gold-900/30 dark:to-gold-800/20 rounded-2xl flex items-center justify-center cursor-default">
          <Flame className="w-8 h-8 text-gold-500" />
        </button>

        <div className="text-center space-y-2">
          <h3 className="text-base font-bold text-dark-800 dark:text-ivory-200">Түлш худалдаж авах</h3>
          <p className="text-sm text-dark-600 dark:text-ivory-400 leading-relaxed">
            Жолооч нарт зориулсан түлш худалдан авах үйлчилгээ. Холын тээврийн жолооч нар хөнгөлөлттэй үнээр
            ОХУ-ын АЗС-уудаас дизель түлш худалдан авах боломжтой.
          </p>
          <p className="text-sm text-dark-600 dark:text-ivory-400">
            Систем нь захиалга авсанаас хойш админд автоматаар дамжуулан таны хүсэлтийг боловсруулна.
            Админ баталгаажуулсны дараа таны түлш цэнэглэгдэнэ.
          </p>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 bg-gold-50 dark:bg-gold-900/20 text-gold-700 dark:text-gold-400 rounded-xl text-xs font-medium">
          <Clock3 className="w-4 h-4" />
          Удахгүй нэмэгдэнэ
        </div>
      </div>
    </div>
  );
}
