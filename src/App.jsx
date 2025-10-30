import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, query, addDoc, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { Loader, Camera, Plus, List, X, Trash2, Edit, CheckCircle, Clock, Package, Calendar } from 'lucide-react';

// --- START: Configuration for Vercel/Local Deployment ---
// Vercel/Vite 會自動從 "import.meta.env" 讀取 VITE_ 開頭的環境變數
// 您必須在 Vercel 專案的 Settings > Environment Variables 中設定這些值

// FIX: Safely access import.meta.env to avoid build warnings in environments that don't support it.
const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

const firebaseConfig = {
  apiKey: env.VITE_API_KEY,
  authDomain: env.VITE_AUTH_DOMAIN,
  projectId: env.VITE_PROJECT_ID,
  storageBucket: env.VITE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_MESSAGING_SENDER_ID,
  appId: env.VITE_APP_ID
};

// 檢查本地設定是否完整 (用於 Vercel 部署)
const isLocalConfigValid = firebaseConfig.projectId && firebaseConfig.apiKey;

// --- Canvas Environment Fallbacks (REMOVED for clarity) ---
// We are now fully on Vercel/localhost, so Canvas fallbacks are removed.
const finalFirebaseConfig = firebaseConfig;

// FIX: Load Gemini API Key from Vercel Environment Variables
const API_KEY = env.VITE_GEMINI_API_KEY;

// 這是您的資料儲存路徑
const APP_DATA_PATH = "skincare-app-data"; 
// --- END: Configuration ---


// --- Utility Functions ---

/**
 * Converts a File object (like an image) into a Base64 string for API payload.
 * @param {File} file The image file.
 * @returns {Promise<string>} Base64 encoded data string.
 */
const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
};

/**
 * Formats a Date object into YYYY-MM-DD string.
 * @param {Date | string | null} dateInput
 */
const formatDate = (dateInput) => {
    if (!dateInput) return '';
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    return date.toISOString().split('T')[0];
};

/**
 * Calculates days until expiry and returns status color.
 * @param {string | null} expiryDateString YYYY-MM-DD
 * @param {string | null} openedDateString YYYY-MM-DD
 * @returns {{daysRemaining: number | null, gradient: string, statusText: string, badgeStyle: string}}
 */
const getProductStatus = (expiryDateString, openedDateString) => {
    if (!expiryDateString) {
        return { 
            daysRemaining: null, 
            gradient: 'from-gray-400 to-gray-500', 
            statusText: '未設定效期', 
            badgeStyle: 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-600' 
        };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiryDate = new Date(expiryDateString);
    expiryDate.setHours(0, 0, 0, 0);

    const diffTime = expiryDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let gradient = 'from-emerald-400 to-teal-500';
    let statusText = `${daysRemaining} 天後過期`;
    let badgeStyle = 'bg-gradient-to-r from-emerald-50 to-teal-50 text-teal-700';

    if (daysRemaining < 0) {
        gradient = 'from-red-500 to-rose-600';
        statusText = '已過期';
        badgeStyle = 'bg-gradient-to-r from-red-50 to-rose-50 text-red-700';
    } else if (daysRemaining <= 30) {
        gradient = 'from-amber-400 to-orange-500';
        statusText = `即將過期 ${daysRemaining} 天`;
        badgeStyle = 'bg-gradient-to-r from-amber-50 to-orange-50 text-orange-700';
    }

    if (openedDateString) {
        statusText += ' • 已開封';
    }

    return { daysRemaining, gradient, statusText, badgeStyle };
};


// --- Firebase Initialization and Auth Hook ---

const useFirebase = () => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [firebaseError, setFirebaseError] = useState(null);

    useEffect(() => {
        try {
            if (!finalFirebaseConfig || !finalFirebaseConfig.projectId) {
                // This error will now clearly state if Vercel env vars are missing
                throw new Error("Firebase config is missing or incomplete. If deploying on Vercel, ensure all VITE_... environment variables are set.");
            }
            const app = initializeApp(finalFirebaseConfig);
            const firestore = getFirestore(app);
            const authInstance = getAuth(app);

            setDb(firestore);
            setAuth(authInstance);

            const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    // Fallback for local dev and Vercel
                    await signInAnonymously(authInstance);
                    setUserId(authInstance.currentUser?.uid);
                }
                setIsAuthReady(true);
            });

            return () => unsubscribe();
        } catch (error) {
            console.error("Firebase Initialization Error:", error);
            setFirebaseError(error.message);
            setIsAuthReady(true); // Stop loading
        }
    }, []);

    return { db, auth, userId, isAuthReady, firebaseError };
};


// --- Product Management Component ---

// FIX: Removed isLoading/setIsLoading props. Form will manage its own busy state.
const AddProductForm = ({ userId, db, onSave, onCancel, initialData = null }) => {
    const [formState, setFormState] = useState({
        brand: initialData?.brand || '',
        name: initialData?.name || '',
        expiryDate: initialData?.expiryDate ? formatDate(initialData.expiryDate) : '',
        openedDate: initialData?.openedDate ? formatDate(initialData.openedDate) : '',
        purchaseDate: initialData?.purchaseDate ? formatDate(initialData.purchaseDate) : '',
        notes: initialData?.notes || '',
        photoBase64: initialData?.photoBase64 || null,
        file: null,
    });
    const [statusMessage, setStatusMessage] = useState('');
    
    // FIX: Add internal loading state for AI and Save buttons
    const [isFormBusy, setIsFormBusy] = useState(false);

    const isEditing = !!initialData;

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setFormState(prev => ({ ...prev, file: file, photoBase64: null }));
            const reader = new FileReader();
            reader.onloadend = () => {
                setFormState(prev => ({ ...prev, photoBase64: reader.result }));
            };
            reader.readAsDataURL(file);
        }
    };

    const handleAnalyzeImage = async () => {
        if (!formState.file) {
            setStatusMessage('請先上傳圖片才能進行 AI 辨識。');
            return;
        }
        
        // FIX: Check for API Key
        if (!API_KEY) {
            setStatusMessage('❌ AI 辨識失敗: 未設定 Gemini API 金鑰。請在 Vercel 中設定 VITE_GEMINI_API_KEY。');
            return;
        }

        // FIX: Use internal form busy state
        setIsFormBusy(true);
        setStatusMessage('AI 正在辨識圖片中，請稍候...');

        try {
            const base64Data = await fileToBase64(formState.file);
            // FIX: Simplified prompt
            const userPrompt = "Analyze this image of a skincare product and extract the brand and product name.";
            const apiUrl = `https.generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;
            
            const payload = {
                contents: [{
                    role: "user",
                    parts: [
                        { text: userPrompt },
                        { inlineData: { mimeType: formState.file.type, data: base64Data } }
                    ]
                }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: {
                            "brand": { "type": "STRING", "description": "The brand name of the product." },
                            "name": { "type": "STRING", "description": "The specific product name (e.g., Hyaluronic Acid Serum)." }
                        },
                        "propertyOrdering": ["brand", "name"]
                    }
                }
            };

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                // Try to parse error response
                let errorBody = await response.text();
                try {
                    errorBody = JSON.parse(errorBody).error.message;
                } catch(e) {
                    // ignore if not json
                }
                throw new Error(`API error: ${response.status} ${response.statusText}. ${errorBody}`);
            }

            const result = await response.json();
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;

            if (jsonText) {
                const parsedJson = JSON.parse(jsonText);
                setFormState(prev => ({
                    ...prev,
                    brand: parsedJson.brand || prev.brand,
                    name: parsedJson.name || prev.name
                }));
                setStatusMessage('✨ AI 辨識完成！請確認並補齊其他資訊');
            } else {
                setStatusMessage('AI 無法辨識產品資訊，請手動輸入。');
            }

        } catch (error) {
            console.error("Gemini API Error:", error);
            setStatusMessage(`❌ AI 辨識失敗: ${error.message}`);
        } finally {
            // FIX: Use internal form busy state
            setIsFormBusy(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formState.name || !formState.brand) {
            setStatusMessage('請至少填寫品牌和產品名称。');
            return;
        }

        // FIX: Use internal form busy state
        setIsFormBusy(true);
        setStatusMessage('正在儲存產品資訊...');

        const { file, ...serializableFormState } = formState;

        const productData = {
            ...serializableFormState,
            userId,
            createdAt: isEditing ? initialData.createdAt : new Date(),
            updatedAt: new Date(),
        };

        try {
            // FIX: Path should be collection/document/collection (3 segments)
            const dataPath = `${APP_DATA_PATH}/${userId}/products`;
            
            if (isEditing) {
                const productRef = doc(db, dataPath, initialData.id);
                await updateDoc(productRef, productData);
                setStatusMessage('✅ 更新成功！');
            } else {
                await addDoc(collection(db, dataPath), productData);
                // FIX: This message will now be visible because the form doesn't get destroyed
                setStatusMessage('✅ 新增成功！');
            }
            // Wait 500ms so user can see the success message
            setTimeout(() => onSave(), 500); 
        } catch (error) {
            console.error("Firestore Save Error:", error);
            setStatusMessage(`❌ 儲存失敗: ${error.message}`);
        } finally {
            // FIX: Use internal form busy state
            // We set it to false, though the component will unmount shortly
            setIsFormBusy(false);
        }
    };

    return (
        <div className="p-6 space-y-5 max-w-lg mx-auto">
            {/* Glassmorphism Card */}
            <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-6">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent mb-6">
                    {isEditing ? '✏️ 編輯保養品' : '✨ 新增保養品'}
                </h2>
                
                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Photo Upload with AI */}
                    <div className="space-y-3">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">📸 產品照片</label>
                        
                        <div className="relative">
                            <input
                                type="file"
                                accept="image/*"
                                // FIX: Removed 'capture="environment"' to allow gallery selection
                                onChange={handleFileChange}
                                className="hidden"
                                id="photo-upload"
                            />
                            <label 
                                htmlFor="photo-upload"
                                className="flex items-center justify-center w-full px-4 py-3 bg-gradient-to-r from-teal-50 to-emerald-50 border-2 border-dashed border-teal-300 rounded-2xl cursor-pointer hover:border-teal-400 transition-all duration-300 hover:shadow-lg"
                            >
                                <Camera className="w-5 h-5 text-teal-600 mr-2" />
                                <span className="text-sm font-medium text-teal-700">
                                    {formState.photoBase64 ? '更換照片' : '點擊上傳照片'}
                                </span>
                            </label>
                        </div>

                        {formState.photoBase64 && (
                            <div className="relative group">
                                <div className="relative w-full h-64 bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl overflow-hidden shadow-lg">
                                    <img 
                                        src={formState.photoBase64} 
                                        alt="產品照片預覽" 
                                        className="object-contain w-full h-full"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                                </div>
                                
                                {!isEditing && (
                                    <button
                                        type="button"
                                        onClick={handleAnalyzeImage}
                                        // FIX: Use internal form busy state
                                        disabled={isFormBusy}
                                        className="absolute bottom-4 right-4 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-full shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center text-sm font-medium"
                                    >
                                        {/* FIX: Use internal form busy state */}
                                        {isFormBusy ? (
                                            <>
                                                <Loader className="w-4 h-4 mr-2 animate-spin" />
                                                辨識中...
                                            </>
                                        ) : (
                                            <>
                                                <Camera className="w-4 h-4 mr-2" />
                                                AI 智能辨識
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Input Fields with Icons */}
                    <div className="grid grid-cols-1 gap-4">
                        <InputField 
                            label="品牌名稱" 
                            name="brand" 
                            value={formState.brand} 
                            onChange={handleChange} 
                            required 
                            icon={<Package className="w-4 h-4" />}
                        />
                        <InputField 
                            label="產品名稱" 
                            name="name" 
                            value={formState.name} 
                            onChange={handleChange} 
                            required 
                            icon={<List className="w-4 h-4" />}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                        <InputField 
                            label="有效期限" 
                            name="expiryDate" 
                            type="date" 
                            value={formState.expiryDate} 
                            onChange={handleChange}
                            icon={<Clock className="w-4 h-4" />}
                        />
                        <InputField 
                            label="開封日期" 
                            name="openedDate" 
                            type="date" 
                            value={formState.openedDate} 
                            onChange={handleChange}
                            icon={<Calendar className="w-4 h-4" />}
                        />
                        <InputField 
                            label="購入日期" 
                            name="purchaseDate" 
                            type="date" 
                            value={formState.purchaseDate} 
                            onChange={handleChange}
                            icon={<Calendar className="w-4 h-4" />}
                        />
                    </div>

                    {/* Notes */}
                    <div>
                        <label htmlFor="notes" className="block text-sm font-semibold text-gray-700 mb-2">
                            📝 備註 / 用途
                        </label>
                        <textarea
                            id="notes"
                            name="notes"
                            value={formState.notes}
                            onChange={handleChange}
                            rows="3"
                            placeholder="例如:早晚使用、敏感肌適用..."
                            className="w-full rounded-2xl border-2 border-gray-200 focus:border-teal-400 focus:ring-4 focus:ring-teal-100 p-3 transition-all duration-300 resize-none"
                        ></textarea>
                    </div>

                    {/* Status Message */}
                    {statusMessage && (
                        <div className={`p-4 rounded-2xl ${
                            statusMessage.includes('失敗') || statusMessage.includes('❌') 
                                ? 'bg-red-50 text-red-700 border border-red-200' 
                                : 'bg-teal-50 text-teal-700 border border-teal-200'
                        }`}>
                            <p className="text-sm font-medium">{statusMessage}</p>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="flex-1 px-6 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-2xl transition-all duration-300 shadow-md hover:shadow-lg active:scale-95"
                            // FIX: Use internal form busy state
                            disabled={isFormBusy}
                        >
                            <X className="w-5 h-5 inline-block mr-1" /> 取消
                        </button>
                        <button
                            type="submit"
                            className="flex-1 px-6 py-3.5 bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 text-white font-semibold rounded-2xl transition-all duration-300 shadow-lg hover:shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                            // FIX: Use internal form busy state
                            disabled={isFormBusy}
                        >
                            {/* FIX: Use internal form busy state */}
                            {isFormBusy ? (
                                <>
                                    <Loader className="w-5 h-5 inline-block mr-1 animate-spin" />
                                    處理中...
                                </>
                            ) : (
                                <>
                                    <CheckCircle className="w-5 h-5 inline-block mr-1" />
                                    {isEditing ? '儲存更新' : '確認新增'}
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const InputField = ({ label, name, type = 'text', value, onChange, required = false, icon = null }) => (
    <div>
        <label htmlFor={name} className="block text-sm font-semibold text-gray-700 mb-2">
            {label} {required && <span className="text-red-500">*</span>}
        </label>
        <div className="relative">
            {icon && (
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {icon}
                </div>
            )}
            <input
                type={type}
                id={name}
                name={name}
                value={value}
                onChange={onChange}
                required={required}
                className={`w-full ${icon ? 'pl-10' : 'pl-4'} pr-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-teal-400 focus:ring-4 focus:ring-teal-100 transition-all duration-300`}
            />
        </div>
    </div>
);

const ProductCard = ({ product, onDelete, onEdit, userId, db, isLoading }) => {
    const { gradient, statusText, badgeStyle } = getProductStatus(product.expiryDate, product.openedDate);

    const handleDelete = async () => {
        // FIX: Use window.confirm for local dev, as custom modals are complex
        if (window.confirm(`確定要刪除產品 "${product.name}" 嗎？`)) {
            try {
                // FIX: Path should be collection/document/collection (3 segments)
                const dataPath = `${APP_DATA_PATH}/${userId}/products`;
                await deleteDoc(doc(db, dataPath, product.id));
            } catch (error) {
                console.error("Delete Error:", error);
            }
        }
    };

    return (
        <div className="group bg-white/80 backdrop-blur-sm rounded-3xl shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden border border-gray-100 hover:scale-[1.02] hover:-translate-y-1">
            <div className="flex p-4">
                {/* Image Thumbnail with Gradient Overlay */}
                <div className="relative w-28 h-28 flex-shrink-0 rounded-2xl overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200">
                    {product.photoBase64 ? (
                        <>
                            <img
                                src={product.photoBase64}
                                alt={product.name}
                                className="w-full h-full object-cover"
                                onError={(e) => { 
                                    e.target.onerror = null; 
                                    e.target.src = "https://placehold.co/112x112/f3f4f6/a1a1aa?text=No+Image"; 
                                }}
                            />
                            <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-20 transition-opacity duration-300`}></div>
                        </>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <Package className="w-10 h-10 text-gray-300" />
                        </div>
                    )}
                </div>

                {/* Details */}
                <div className="flex-grow ml-4 flex flex-col justify-between">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">
                            {product.brand}
                        </p>
                        <h3 className="text-lg font-extrabold text-gray-900 line-clamp-2 mt-1">
                            {product.name}
                        </h3>
                        {product.notes && (
                            <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 italic">
                                {product.notes}
                            </p>
                        )}
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                        <div className="space-y-1">
                            <p className="text-xs text-gray-500 flex items-center">
                                <Clock className="w-3.5 h-3.5 mr-1.5 text-gray-400" />
                                {product.expiryDate || 'N/A'}
                            </p>
                            <span className={`inline-flex items-center text-xs font-semibold px-3 py-1 rounded-full ${badgeStyle} shadow-sm`}>
                                {statusText}
                            </span>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                            <button
                                onClick={() => onEdit(product)}
                                className="p-2.5 bg-gradient-to-r from-amber-400 to-orange-500 text-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 disabled:opacity-50 active:scale-95"
                                disabled={isLoading}
                                aria-label="編輯"
                            >
                                <Edit className="w-4 h-4" />
                            </button>
                            <button
                                onClick={handleDelete}
                                className="p-2.5 bg-gradient-to-r from-red-400 to-rose-500 text-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 disabled:opacity-50 active:scale-95"
                                disabled={isLoading}
                                aria-label="刪除"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Main App Component ---

const App = () => {
    const { db, userId, isAuthReady, firebaseError } = useFirebase();
    const [view, setView] = useState('list');
    const [products, setProducts] = useState([]);
    const [isLoading, setIsLoading] = useState(true); // Default to true on initial load
    const [appError, setAppError] = useState(null); // Combine Firebase error and listener error
    const [editProduct, setEditProduct] = useState(null);

    useEffect(() => {
        // Update appError if firebaseError changes
        if (firebaseError) {
            setAppError(firebaseError);
            setIsLoading(false);
        }
    }, [firebaseError]);

    useEffect(() => {
        if (!isAuthReady || !db || !userId) {
            // Don't fetch if not ready
            if (isAuthReady) {
                 // We are authenticated but missing db or userId (shouldn't happen, but good to check)
                setIsLoading(false);
                if (!appError) {
                    setAppError("Firebase 服務已準備就緒，但資料庫或使用者 ID 遺失。");
                }
            }
            return;
        }
        
        // Only set loading to true when we are actually starting the fetch
        setIsLoading(true);

        // FIX: Path should be collection/document/collection (3 segments)
        const productsColRef = collection(db, `${APP_DATA_PATH}/${userId}/products`);
        const q = query(productsColRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const productsList = [];
            snapshot.forEach(doc => {
                productsList.push({ id: doc.id, ...doc.data() });
            });
            productsList.sort((a, b) => {
                const dateA = a.expiryDate ? new Date(a.expiryDate) : new Date('9999-12-31');
                const dateB = b.expiryDate ? new Date(b.expiryDate) : new Date('9999-12-31');
                return dateA.getTime() - dateB.getTime();
            });

            setProducts(productsList);
            setIsLoading(false);
            setAppError(null); // Clear previous errors on success
        }, (error) => {
            // FIX: THIS IS THE CRITICAL FIX
            // Set the error state so the UI can display it
            console.error("Firestore Listener Error:", error);
            setAppError(`Firestore 讀取錯誤: ${error.message}. (請檢查您的 Firestore 安全規則是否允許匿名讀取)`);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [isAuthReady, db, userId]); // Rerun only when auth state changes

    const handleSave = useCallback(() => {
        setView('list');
        setEditProduct(null);
        // Scroll to top after saving
        const rootEl = document.getElementById('root');
        if (rootEl) {
            rootEl.scrollTo(0, 0);
        }
    }, []);

    const handleEdit = useCallback((product) => {
        setEditProduct(product);
        setView('edit');
        // Scroll to top to show edit form
        const rootEl = document.getElementById('root');
        if (rootEl) {
            rootEl.scrollTo(0, 0);
        }
    }, []);

    // --- FIX: Simplified Render Logic ---
    let content;
    if (!isAuthReady) {
        content = (
            <div className="flex flex-col items-center justify-center h-[70vh] p-4">
                <Loader className="w-12 h-12 animate-spin text-teal-500 mb-6" />
                <p className="text-gray-600 font-semibold text-lg text-center">正在連線至雲端服務...</p>
            </div>
        );
    } else if (appError) {
        content = (
            <div className="flex flex-col items-center justify-center h-[70vh] p-4">
                <div className="relative mb-6">
                    <div className="w-16 h-16 border-4 border-red-200 rounded-full"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <X className="w-8 h-8 text-red-600" />
                    </div>
                </div>
                <p className="mt-6 text-red-700 font-semibold text-lg text-center">
                    載入失敗
                </p>
                <p className="mt-2 text-gray-600 text-sm text-center">
                    {appError.includes("config is missing") 
                        ? "錯誤：找不到 Firebase 設定。請檢查 Vercel 上的環境變數 (VITE_...) 是否已正確設定並重新部署。" 
                        : appError}
                </p>
            </div>
        );
    } else if (isLoading) {
         content = (
            <div className="flex flex-col items-center justify-center h-[70vh] p-4">
                <Loader className="w-12 h-12 animate-spin text-teal-500 mb-6" />
                <p className="text-gray-600 font-semibold text-lg text-center">正在載入產品資料...</p>
            </div>
        );
    } else if (view === 'add' || view === 'edit') {
        content = (
            <AddProductForm
                userId={userId}
                db={db}
                onSave={handleSave}
                onCancel={() => {
                  setView('list');
                  // Scroll to top when canceling
                  const rootEl = document.getElementById('root');
                  if (rootEl) {
                      rootEl.scrollTo(0, 0);
                  }
                }}
                // FIX: Removed isLoading/setIsLoading props
                initialData={editProduct}
            />
        );
    } else {
        // This block now handles both empty list and list with products
        content = (
             <div className="p-5 space-y-4">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-2xl font-bold bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">
                            我的保養品
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">共 {products.length} 件產品</p>
                    </div>
                </div>

                {products.length === 0 ? (
                    <div className="text-center py-20 bg-gradient-to-br from-teal-50 via-emerald-50 to-cyan-50 rounded-3xl border-2 border-dashed border-teal-200">
                        <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-teal-100 to-emerald-100 rounded-full flex items-center justify-center">
                            <Package className="w-10 h-10 text-teal-600" />
                        </div>
                        <p className="text-gray-600 font-semibold text-lg">清單是空的</p>
                        <p className="text-gray-500 text-sm mt-2">點擊右下角的 ＋ 按鈕新增第一個產品</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {products.map(product => (
                            <ProductCard
                                key={product.id}
                                product={product}
                                onDelete={() => {}}
                                onEdit={handleEdit}
                                userId={userId}
                                db={db}
                                isLoading={isLoading} // Pass list loading state for delete/edit buttons
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-50 to-emerald-50 font-sans">
<style>{`
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');
  
  body { 
    font-family: 'Inter', sans-serif; 
    overflow-x: hidden;
  }
  
  /* 平滑滾動 */
  * {
    scroll-behavior: smooth;
    box-sizing: border-box;
  }
  
  /* Android Chrome 自定義滾動條 */
  ::-webkit-scrollbar {
    width: 8px;
  }
  ::-webkit-scrollbar-track {
    background: #f1f1f1;
  }
  ::-webkit-scrollbar-thumb {
    background: linear-gradient(to bottom, #14b8a6, #10b981);
    border-radius: 10px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(to bottom, #0d9488, #059669);
  }
  
  /* 確保觸控目標足夠大 */
  button { 
    min-height: 48px;
    min-width: 48px;
  }
  
  /* 圖片不溢出 */
  img {
    max-width: 100%;
    height: auto;
  }
`}</style>

            {/* Header with Glassmorphism */}
            <header className="sticky top-0 bg-white/70 backdrop-blur-xl shadow-lg z-50 border-b border-white/20">
                <div className="p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-extrabold bg-gradient-to-r from-teal-600 via-emerald-600 to-cyan-600 bg-clip-text text-transparent tracking-tight">
                                ✨ 保養品管理
                            </h1>
                            <p className="text-xs text-gray-500 mt-1">智能追蹤 • 效期提醒</p>
                        </div>
                        <div className="w-12 h-12 bg-gradient-to-br from-teal-400 to-emerald-500 rounded-2xl flex items-center justify-center shadow-lg">
                            <Package className="w-6 h-6 text-white" />
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="pb-28 pt-2 px-0">
                {content}
            </main>

            {/* Floating Action Button (FAB) with Enhanced Design */}
            {view === 'list' && !appError && (
                <button
                    onClick={() => {
                        setEditProduct(null);
                        setView('add');
                        
                        // 【FIX: SCROLL TO TOP】
                        // This forces the app to scroll to the top of the #root container
                        // to show the form, solving the "button not working" issue.
                        const rootEl = document.getElementById('root');
                        if (rootEl) {
                            rootEl.scrollTo(0, 0);
                        }
                    }}
                    className="fixed bottom-6 right-6 group"
                    aria-label="新增產品"
                >
                    {/* Pulsing Background */}
                    <div className="absolute inset-0 bg-gradient-to-r from-teal-400 to-emerald-500 rounded-full animate-ping opacity-75"></div>
                    
                    {/* Main Button */}
                    <div className="relative w-16 h-16 bg-gradient-to-br from-teal-500 via-emerald-500 to-cyan-600 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-active:scale-95 group-hover:shadow-3xl">
                        <Plus className="w-8 h-8 text-white transition-transform duration-300 group-hover:rotate-90" />
                    </div>
                    
                    {/* Tooltip */}
                    <div className="hidden absolute bottom-full right-0 mb-3 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap pointer-events-none">
                        新增保養品
                        <div className="absolute top-full right-6 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                    </div>
                </button>
            )}
        </div>
    );
};

export default App;

