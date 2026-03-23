import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Save, FileText, Download, Trash2, Sparkles, FileVideo, Settings, HelpCircle, CheckCircle2, AlertCircle, Clock, Loader2, Eye, LogIn, LogOut, User as UserIcon, History, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { transcribeAudio, summarizeTranscript } from './services/gemini';
import { exportToTxt, exportToDocx, exportToPdf } from './utils/export';
import ReactMarkdown from 'react-markdown';
import { auth, signInWithGoogle, logout, saveTranscript, getTranscripts } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Toaster, toast } from 'sonner';

// --- Types ---
interface FileStatus {
  id: string;
  name: string;
  size: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  transcript?: string;
  summary?: string | null;
  createdAt?: Date;
  error?: string;
}

// --- Main App Component ---
export default function App() {
  const [activeTab, setActiveTab] = useState<'live' | 'upload'>('live');
  const [transcript, setTranscript] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [language, setLanguage] = useState('vi-VN');
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [savedTranscripts, setSavedTranscripts] = useState<FileStatus[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [fontSize, setFontSize] = useState('text-lg');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Load saved transcripts from Firestore
        const unsubTranscripts = getTranscripts(currentUser.uid, (data) => {
          setSavedTranscripts(data);
        });
        return () => unsubTranscripts();
      } else {
        setSavedTranscripts([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.error('Trình duyệt không hỗ trợ nhận diện giọng nói.');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = true;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.lang = language;

    recognitionRef.current.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        setTranscript(prev => prev + (prev ? ' ' : '') + finalTranscript);
      }
    };

    recognitionRef.current.onerror = (event: any) => {
      console.error('Lỗi nhận diện:', event.error);
      setIsRecording(false);
      
      let errorMessage = 'Lỗi nhận diện giọng nói.';
      if (event.error === 'network') errorMessage = 'Lỗi kết nối mạng. Vui lòng kiểm tra internet.';
      if (event.error === 'not-allowed') errorMessage = 'Quyền truy cập micro bị từ chối.';
      if (event.error === 'no-speech') errorMessage = 'Không phát hiện thấy giọng nói.';
      
      toast.error(errorMessage);
    };

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [language]);

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      recognitionRef.current.start();
      setIsRecording(true);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    const newFiles: FileStatus[] = Array.from(selectedFiles).map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
      status: 'pending'
    }));

    setFiles(prev => [...prev, ...newFiles]);

    // Process each file
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const fileId = newFiles[i].id;

      updateFileStatus(fileId, 'processing');

      try {
        const reader = new FileReader();
        const resultPromise = new Promise<string>((resolve, reject) => {
          reader.onload = async () => {
            try {
              const base64 = (reader.result as string).split(',')[1];
              const result = await transcribeAudio(base64, file.type);
              resolve(result);
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = reject;
        });
        reader.readAsDataURL(file);
        
        const transcriptResult = await resultPromise;
        
        // Save to Firestore if user is logged in
        if (auth.currentUser) {
          await saveTranscript({
            id: fileId,
            name: file.name,
            transcript: transcriptResult,
            userId: auth.currentUser.uid
          });
        }

        setFiles(prev => prev.map(f => 
          f.id === fileId ? { ...f, status: 'completed', transcript: transcriptResult } : f
        ));
        
        // If it's the first file or no file is selected, show its transcript
        if (i === 0 && !transcript) {
          setTranscript(transcriptResult);
          setSelectedFileId(fileId);
        }
      } catch (error: any) {
        console.error(`Lỗi xử lý file ${file.name}:`, error);
        updateFileStatus(fileId, 'error', error.message);
        toast.error(`Lỗi xử lý file ${file.name}: ${error.message}`);
      }
    }
  };

  const updateFileStatus = (id: string, status: FileStatus['status'], error?: string) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status, error } : f));
  };

  const selectFile = (file: FileStatus) => {
    if (file.transcript) {
      setTranscript(file.transcript);
      setSelectedFileId(file.id);
      setSummary(file.summary || null);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
      toast.success('Đăng nhập thành công!');
    } catch (error: any) {
      console.error('Login failed:', error);
      toast.error('Đăng nhập thất bại: ' + (error.message || 'Vui lòng thử lại sau.'));
    }
  };

  const handleSummarize = async () => {
    if (!transcript) return;
    setIsProcessing(true);
    try {
      const result = await summarizeTranscript(transcript);
      setSummary(result);
      
      // Update summary in Firestore if user is logged in
      if (auth.currentUser && selectedFileId) {
        const currentFile = files.find(f => f.id === selectedFileId) || savedTranscripts.find(f => f.id === selectedFileId);
        if (currentFile) {
          await saveTranscript({
            id: selectedFileId,
            name: currentFile.name,
            transcript: transcript,
            summary: result,
            userId: auth.currentUser.uid
          });
        }
      }
    } catch (error: any) {
      console.error('Lỗi tóm tắt:', error);
      setSummary(`⚠️ **Lỗi:** ${error.message}`);
      toast.error('Lỗi tóm tắt: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const clearAll = () => {
    if (confirm('Bạn có chắc chắn muốn xóa toàn bộ nội dung?')) {
      setTranscript('');
      setSummary(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#202124] font-sans selection:bg-blue-100">
      <Toaster position="top-right" richColors closeButton />
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2.5 rounded-xl shadow-lg shadow-blue-200">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800 tracking-tight">VioScribe <span className="text-blue-600">AI</span></h1>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">Meeting Assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-3 bg-gray-50 p-1 pr-4 rounded-full border border-gray-100">
              <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-8 h-8 rounded-full border border-gray-200" referrerPolicy="no-referrer" />
              <div className="hidden sm:block">
                <p className="text-xs font-bold text-gray-800 leading-none">{user.displayName}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{user.email}</p>
              </div>
              <button onClick={logout} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors" title="Đăng xuất">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              className="flex items-center gap-2 bg-white px-4 py-2 rounded-full border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
            >
              <LogIn className="w-4 h-4 text-blue-600" />
              Đăng nhập
            </button>
          )}
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className={`p-2.5 rounded-xl transition-all ${showHistory ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'bg-white text-gray-500 border border-gray-100 hover:bg-gray-50'}`}
            title="Lịch sử đám mây"
          >
            <History className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2.5 rounded-xl transition-all ${showSettings ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'bg-white text-gray-500 border border-gray-100 hover:bg-gray-50'}`}
            title="Cài đặt"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 md:p-8">
        {/* Settings Modal */}
        <AnimatePresence>
          {showSettings && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-3xl p-8 shadow-2xl border border-gray-100 w-full max-w-md"
              >
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-xl font-bold text-gray-900">Cài đặt ứng dụng</h2>
                  <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                    <Trash2 className="w-5 h-5 text-gray-400 rotate-45" />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-gray-800">Tự động lưu</p>
                      <p className="text-[10px] text-gray-500">Lưu bản ghi lên đám mây ngay khi hoàn thành</p>
                    </div>
                    <button 
                      onClick={() => setAutoSave(!autoSave)}
                      className={`w-12 h-6 rounded-full transition-all relative ${autoSave ? 'bg-blue-600' : 'bg-gray-200'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${autoSave ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm font-bold text-gray-800">Cỡ chữ văn bản</p>
                    <div className="grid grid-cols-3 gap-2">
                      {['text-sm', 'text-lg', 'text-2xl'].map((size) => (
                        <button
                          key={size}
                          onClick={() => setFontSize(size)}
                          className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                            fontSize === size ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-100 text-gray-500 hover:border-blue-100'
                          }`}
                        >
                          {size === 'text-sm' ? 'Nhỏ' : size === 'text-lg' ? 'Vừa' : 'Lớn'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-6 border-t border-gray-100">
                    <button
                      onClick={() => setShowSettings(false)}
                      className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
                    >
                      Lưu thay đổi
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Sidebar: History (Conditional) */}
          <AnimatePresence>
            {showHistory && (
              <motion.div
                initial={{ opacity: 0, width: 0, x: -20 }}
                animate={{ opacity: 1, width: 'auto', x: 0 }}
                exit={{ opacity: 0, width: 0, x: -20 }}
                className="lg:col-span-3 space-y-6 overflow-hidden"
              >
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 min-h-[600px] flex flex-col">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-bold text-gray-900">Lịch sử</h2>
                    <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-1 rounded-full">
                      {savedTranscripts.length}
                    </span>
                  </div>
                  
                  {!user ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className="bg-gray-50 p-4 rounded-full mb-4">
                        <UserIcon className="w-8 h-8 text-gray-400" />
                      </div>
                      <p className="text-xs text-gray-600 font-medium mb-4">Đăng nhập để xem lịch sử</p>
                      <button
                        onClick={handleLogin}
                        className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors"
                      >
                        Đăng nhập
                      </button>
                    </div>
                  ) : savedTranscripts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <p className="text-xs text-gray-400">Chưa có dữ liệu.</p>
                    </div>
                  ) : (
                    <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar flex-1">
                      {savedTranscripts.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => selectFile(item)}
                          className={`w-full text-left p-3 rounded-xl border transition-all group ${
                            selectedFileId === item.id 
                              ? 'bg-blue-50 border-blue-200' 
                              : 'bg-white border-gray-100 hover:border-blue-100'
                          }`}
                        >
                          <h3 className="text-xs font-bold text-gray-800 truncate mb-1">{item.name}</h3>
                          <p className="text-[10px] text-gray-400 mb-2">
                            {item.createdAt?.toLocaleDateString()}
                          </p>
                          <div className="flex items-center gap-2">
                            {item.summary && (
                              <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                                Tóm tắt
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main Content Area */}
          <div className={`${showHistory ? 'lg:col-span-9' : 'lg:col-span-12'} space-y-6 transition-all duration-300`}>
            {/* Tabs & Options Row */}
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
              <div className="flex gap-2 bg-gray-200/50 p-1 rounded-xl w-fit">
                <button
                  onClick={() => setActiveTab('live')}
                  className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                    activeTab === 'live' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Mic className="w-4 h-4" />
                  Ghi âm trực tiếp
                </button>
                <button
                  onClick={() => setActiveTab('upload')}
                  className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                    activeTab === 'upload' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <FileVideo className="w-4 h-4" />
                  Tải lên tệp tin
                </button>
              </div>

              <div className="flex items-center gap-4 w-full md:w-auto">
                <select 
                  value={language} 
                  onChange={(e) => setLanguage(e.target.value)}
                  className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer shadow-sm flex-1 md:flex-none"
                >
                  <option value="vi-VN">Tiếng Việt</option>
                  <option value="en-US">English</option>
                </select>
                {!user && (
                  <div className="hidden md:flex items-center gap-2 text-[10px] font-bold text-amber-600 bg-amber-50 px-3 py-2 rounded-xl border border-amber-100">
                    <AlertCircle className="w-3 h-3" />
                    Đăng nhập để lưu đám mây
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Content Column */}
              <div className="lg:col-span-2 space-y-6">
            {/* Action Card */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
              {activeTab === 'live' ? (
                <div className="flex flex-col items-center justify-center py-10 space-y-6">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={toggleRecording}
                    className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 relative ${
                      isRecording ? 'bg-red-500 shadow-lg shadow-red-200' : 'bg-blue-600 shadow-lg shadow-blue-200'
                    }`}
                  >
                    {isRecording ? (
                      <MicOff className="text-white w-10 h-10" />
                    ) : (
                      <Mic className="text-white w-10 h-10" />
                    )}
                    {isRecording && (
                      <motion.div
                        animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="absolute inset-0 bg-red-500 rounded-full -z-10"
                      />
                    )}
                  </motion.button>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-gray-800">
                      {isRecording ? 'Đang ghi âm...' : 'Nhấn để bắt đầu ghi âm'}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      Hỗ trợ ghi âm từ micro hoặc cuộc họp online
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-gray-200 rounded-xl hover:border-blue-400 transition-colors group">
                    <input
                      type="file"
                      id="file-upload"
                      className="hidden"
                      accept="audio/*,video/*"
                      multiple
                      onChange={handleFileUpload}
                    />
                    <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                      <div className="bg-blue-50 p-4 rounded-full group-hover:bg-blue-100 transition-colors mb-4">
                        <FileVideo className="w-10 h-10 text-blue-600" />
                      </div>
                      <p className="text-lg font-semibold text-gray-800">Tải lên nhiều tệp tin</p>
                      <p className="text-sm text-gray-500 mt-1">Hỗ trợ MP4, MP3, WAV, M4A...</p>
                    </label>
                  </div>

                  {files.length > 0 && (
                    <div className="overflow-hidden border border-gray-100 rounded-xl shadow-sm">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                          <tr>
                            <th className="px-4 py-3 font-bold">Tên tệp</th>
                            <th className="px-4 py-3 font-bold">Kích thước</th>
                            <th className="px-4 py-3 font-bold">Trạng thái</th>
                            <th className="px-4 py-3 font-bold text-center">Hành động</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {files.map((file) => (
                            <tr key={file.id} className={`hover:bg-gray-50 transition-colors ${selectedFileId === file.id ? 'bg-blue-50/50' : ''}`}>
                              <td className="px-4 py-3 text-sm font-medium text-gray-700 truncate max-w-[200px]" title={file.name}>
                                {file.name}
                              </td>
                              <td className="px-4 py-3 text-xs text-gray-500">
                                {file.size}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  {file.status === 'pending' && <Clock className="w-4 h-4 text-gray-400" />}
                                  {file.status === 'processing' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                                  {file.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                                  {file.status === 'error' && (
                                    <div className="group relative">
                                      <AlertCircle className="w-4 h-4 text-red-500 cursor-help" />
                                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-gray-900 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30 shadow-xl">
                                        {file.error || 'Lỗi không xác định'}
                                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-gray-900" />
                                      </div>
                                    </div>
                                  )}
                                  <span className={`text-xs font-semibold ${
                                    file.status === 'completed' ? 'text-emerald-600' : 
                                    file.status === 'processing' ? 'text-blue-600' : 
                                    file.status === 'error' ? 'text-red-600' : 'text-gray-500'
                                  }`}>
                                    {file.status === 'pending' && 'Chờ xử lý'}
                                    {file.status === 'processing' && 'Đang xử lý...'}
                                    {file.status === 'completed' && 'Hoàn thành'}
                                    {file.status === 'error' && 'Lỗi'}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                {file.status === 'completed' && (
                                  <button
                                    onClick={() => selectFile(file)}
                                    className={`p-1.5 rounded-lg transition-colors ${
                                      selectedFileId === file.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-600'
                                    }`}
                                    title="Xem văn bản"
                                  >
                                    <Eye className="w-4 h-4" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Transcript Area */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-[500px]">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <h3 className="font-bold text-gray-700 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  Văn bản chuyển đổi
                </h3>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={clearAll}
                    className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-lg transition-colors"
                    title="Xóa tất cả"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 p-6 overflow-y-auto relative">
                {isProcessing && (
                  <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                      <p className="text-sm font-medium text-blue-600">AI đang xử lý...</p>
                    </div>
                  </div>
                )}
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Văn bản sẽ xuất hiện ở đây..."
                  className={`w-full h-full resize-none border-none focus:ring-0 text-gray-700 leading-relaxed placeholder:text-gray-300 ${fontSize}`}
                />
              </div>
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
                <div className="flex gap-2">
                  <button 
                    onClick={() => exportToTxt(transcript)}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <Download className="w-3 h-3" />
                    TXT
                  </button>
                  <button 
                    onClick={() => exportToDocx(transcript)}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <Download className="w-3 h-3" />
                    DOCX
                  </button>
                  <button 
                    onClick={() => exportToPdf(transcript)}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <Download className="w-3 h-3" />
                    PDF
                  </button>
                </div>
                <button
                  onClick={handleSummarize}
                  disabled={!transcript || isProcessing}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-md shadow-blue-100"
                >
                  <Sparkles className="w-4 h-4" />
                  Tóm tắt AI
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar / Summary Area */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 min-h-[400px]">
              <div className="flex items-center gap-2 mb-6">
                <div className="bg-purple-100 p-2 rounded-lg">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                </div>
                <h3 className="font-bold text-gray-800">Tóm tắt cuộc họp</h3>
              </div>
              
              <div className="prose prose-sm max-w-none text-gray-600">
                {summary ? (
                  <div className="markdown-body">
                    <ReactMarkdown>{summary}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center opacity-40">
                    <HelpCircle className="w-12 h-12 mb-4" />
                    <p className="text-sm">Chưa có tóm tắt.<br/>Hãy nhấn "Tóm tắt AI" sau khi có văn bản.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Security Note */}
            <div className="bg-emerald-50 rounded-2xl p-6 border border-emerald-100">
              <h4 className="text-emerald-800 font-bold text-sm mb-2">Bảo mật dữ liệu</h4>
              <p className="text-emerald-700 text-xs leading-relaxed">
                Dữ liệu của bạn được xử lý bảo mật thông qua Google Gemini API. Chúng tôi không lưu trữ nội dung âm thanh của bạn trên máy chủ.
              </p>
            </div>
          </div>
          </div>
        </div>
      </div>
    </main>

      <footer className="max-w-5xl mx-auto p-6 text-center text-gray-400 text-sm">
        &copy; 2026 VioScribe AI. All rights reserved.
      </footer>
    </div>
  );
}
