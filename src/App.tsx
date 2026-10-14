import { useCallback, useEffect, useState } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { Stage, type LoadedImage } from './components/Stage';
import { GENRE_IDS, type GenreId } from './lib/genres';
import { DEFAULT_RATIOS, setRatio, toggleGenre, type Ratios } from './lib/ratios';
import { loadDefaultImage, prepareUpload } from './subject/load';

const DEFAULT_INTENSITY = 0.6;
const defaultIntensity = () =>
  Object.fromEntries(GENRE_IDS.map((g) => [g, DEFAULT_INTENSITY])) as Record<GenreId, number>;

const defaultOptions = () => ({ pop: 0, hiphop: 0.6, electronic: 0, rock: 0, rnb: 0 }) as Record<GenreId, number>;

export default function App() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [ratios, setRatios] = useState<Ratios>(DEFAULT_RATIOS);
  const [intensity, setIntensity] = useState(defaultIntensity);
  const [options, setOptions] = useState(defaultOptions);
  const [freq, setFreq] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [showBoxes, setShowBoxes] = useState(true);
  const [mode, setMode] = useState<'pattern' | 'photo'>('pattern');
  const [resetToken, setResetToken] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  // 업로드한 이미지는 브라우저 안에서만 처리한다 (서버 전송 없음)
  const loadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 사용할 수 있어요.');
      return;
    }
    try {
      const bmp = await createImageBitmap(file);
      setImage(prepareUpload(bmp));
      setError('');
    } catch {
      setError('이미지를 읽지 못했어요. 다른 파일을 시도해 주세요.');
    }
  }, []);

  const loadDefault = useCallback(() => {
    void loadDefaultImage().then((img) => {
      setImage(img);
      setError('');
    });
  }, []);

  // 첫 실행부터 기본 사과 사진을 불러온다
  useEffect(() => {
    void loadDefaultImage().then((img) => setImage((cur) => cur ?? img));
  }, []);

  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const aspect = image ? Math.min(2, Math.max(0.5, image.width / image.height)) : 4 / 3;

  return (
    <div className="app">
      <main
        className="main"
        onDragEnter={() => setDragging(true)}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={(e) => {
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void loadFile(f);
        }}
      >
        <Stage
          image={image}
          aspect={aspect}
          ratios={ratios}
          intensity={intensity}
          options={options}
          freq={freq}
          playing={playing}
          showBoxes={showBoxes}
          mode={mode}
          resetToken={resetToken}
        >
          {!image && (
            <div className="empty">
              <strong>이미지를 업로드하세요</strong>
              <span>클릭하거나 이 영역에 파일을 끌어다 놓으면 장르별로 왜곡됩니다.</span>
              <div className="row">
                <label className="btn primary">
                  파일 선택
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void loadFile(f);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button className="btn" onClick={loadDefault}>
                  기본 사진
                </button>
              </div>
            </div>
          )}
          {dragging && <div className="drop">여기에 놓아 이미지 교체</div>}
        </Stage>
        {error && <div className="error">{error}</div>}
      </main>
      <ControlPanel
        hasImage={!!image}
        ratios={ratios}
        intensity={intensity}
        options={options}
        freq={freq}
        playing={playing}
        showBoxes={showBoxes}
        mode={mode}
        onMode={setMode}
        onUpload={(f) => void loadFile(f)}
        onSample={loadDefault}
        onToggle={(id) => setRatios((r) => toggleGenre(r, id))}
        onRatio={(id, v) => setRatios((r) => setRatio(r, id, v))}
        onIntensity={(id, v) => setIntensity((s) => ({ ...s, [id]: v }))}
        onOption={(id, v) => setOptions((s) => ({ ...s, [id]: v }))}
        onFreq={setFreq}
        onPlaying={setPlaying}
        onShowBoxes={setShowBoxes}
        onReset={() => {
          setRatios(DEFAULT_RATIOS);
          setIntensity(defaultIntensity());
          setOptions(defaultOptions());
          setFreq(1);
          setPlaying(true);
          setShowBoxes(true);
          setMode('pattern');
          setResetToken((n) => n + 1);
        }}
      />
    </div>
  );
}
