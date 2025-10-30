import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, query, addDoc, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { Loader, Camera, Plus, List, X, Trash2, Edit, CheckCircle, Clock, Package, Calendar } from 'lucide-react';

// --- Configuration ---
const APP_DATA_PATH = "skincare-app-data"; 

// --- Environment Variable Handling ---
// FINAL FIX: 直接硬編碼 Firebase 設置，繞過 Vercel/Vite 的環境變數問題。
const getFirebaseConfig = () => {
    // 1. 這是您提供的 Firebase 專案設定
    const HARDCODED_CONFIG = {
        apiKey: "AIzaSyBKVFMND1Z0Ugw4JH_usguMcYu7Qyq1pOM",
        authDomain: "skincaremanager-anita.firebaseapp.com",
        projectId: "skincaremanager-anita",
        storageBucket: "skincaremanager-anita.firebasestorage.app",
        messagingSenderId: "660374271753",
        appId: "1:660374271753:web:eb56765f628ab8e95e85d8",
    };

    if (HARDCODED_CONFIG.projectId) {
        console.log("Using HARDCODED Firebase Config.");
        return HARDCODED_CONFIG;
    }
    
    // 2. 嘗試讀取 Canvas 提供的全域變數 (作為備用)
    if (typeof __firebase_config !== 'undefined') {
        console.log("Using Canvas Global Config.");
        return JSON.parse(__firebase_config);
    }
    
    return null;
};

// API Key (Gemini)
// 由於 Gemini API Key 未在 Vercel 環境變數中設置，因此暫時保留為空
const API_KEY = ""; 

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

    // 讀取 Canvas 的初始 Auth Token
    const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
    const finalFirebaseConfig = getFirebaseConfig();

    useEffect(() => {
        try {
            if (!finalFirebaseConfig || !finalFirebaseConfig.projectId) {
                // 由於硬編碼已失敗，這將是最終的錯誤提示
                throw new Error("config is missing. Please check your Firebase settings or environment variables.");
            }
            const app = initializeApp(finalFirebaseConfig);
            const firestore = getFirestore(app);
            const authInstance = getAuth(app);

            setDb(firestore);
            setAuth(authInstance);

            const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                if (user) {
                    setUserId(user.uid);
                } else if (initialAuthToken) {
                    // This block is for Canvas environment
                    await signInWithCustomToken(authInstance, initialAuthToken);
                    setUserId(authInstance.currentUser?.uid);
                } else {
                    // Fallback for Vercel/local dev
                    await signInAnonymously(authInstance);
                    setUserId(authInstance.currentUser?.uid);
                }
                setIsAuthReady(true);
            });

            return () => unsubscribe();
        } catch (error) {
            console.error("Firebase Initialization Error:", error);
            // 確保錯誤訊息能顯示給用戶看
            setFirebaseError(error.message); 
            setIsAuthReady(true); 
        }
    }, [initialAuthToken]); 

    return { db, auth, userId, isAuthReady, firebaseError };
};


// --- Product Management Component ---

const AddProductForm = ({ userId, db, onSave, onCancel, isLoading, setIsLoading, initialData = null }) => {
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

        setIsLoading(true);
        setStatusMessage('AI 正在辨識圖片中，請稍候...');

        try {
            const base64Data = await fileToBase64(formState.file);
            const userPrompt = "Identify the brand name and the specific product name from this image of a skincare or cosmetic product. Please only return the JSON object.";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;
            
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

            if (!response.ok) throw new Error(`API error: ${response.statusText}`);

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
            setIsLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formState.name || !formState.brand) {
            setStatusMessage('請至少填寫品牌和產品名稱。');
            return;
        }

        setIsLoading(true);
        setStatusMessage('正在儲存產品資訊...');

        const { file, ...serializableFormState } = formState;

        const productData = {
            ...serializableFormState,
            userId,
            createdAt: isEditing ? initialData.createdAt : new Date(),
            updatedAt: new Date(),
        };

        try {
            // Path corrected to 3 segments (Collection/Document/Collection)
            const dataPath = `${APP_DATA_PATH}/${userId}/products`;
            
            if (isEditing) {
                const productRef = doc(db, dataPath, initialData.id);
                await updateDoc(productRef, productData);
                setStatusMessage('✅ 更新成功！');
            } else {
                await addDoc(collection(db, dataPath), productData);
                setStatusMessage('✅ 新增成功！');
            }
            setTimeout(() => onSave(), 500);
        } catch (error) {
            console.error("Firestore Save Error:", error);
            setStatusMessage(`❌ 儲存失敗: ${error.message}`);
        } finally {
            setIsLoading(false);
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
                                capture="environment"
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
                                    <div className={`absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300`}></div>
                                </div>
                                
                                {!isEditing && (
                                    <button
                                        type="button"
                                        onClick={handleAnalyzeImage}
                                        disabled={isLoading}
                                        className="absolute bottom-4 right-4 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-full shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center text-sm font-medium"
                                    >
                                        {isLoading ? (
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
                            disabled={isLoading}
                        >
                            X 取消
                        </button>
                        <button
                            type="submit"
                            className="flex-1 px-6 py-3.5 bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 text-white font-semibold rounded-2xl transition-all duration-300 shadow-lg hover:shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                            disabled={isLoading}
                        >
                            {isLoading ? (
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
        // Use window.confirm for simplicity
        if (window.confirm(`確定要刪除產品 "${product.name}" 嗎？`)) {
            try {
                // Path corrected to 3 segments (Collection/Document/Collection)
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
    const [isLoading, setIsLoading] = useState(false);
    const [editProduct, setEditProduct] = useState(null);

    useEffect(() => {
        if (!isAuthReady || !db || !userId || firebaseError) return;

        setIsLoading(true);
        // Path corrected to 3 segments (Collection/Document/Collection)
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
        }, (error) => {
            console.error("Firestore Listener Error:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [isAuthReady, db, userId, firebaseError]);

    const handleSave = useCallback(() => {
        setView('list');
        setEditProduct(null);
    }, []);

    const handleEdit = useCallback((product) => {
        setEditProduct(product);
        setView('edit');
    }, []);

    let content;
    if (!isAuthReady || firebaseError) {
        content = (
            <div className="flex flex-col items-center justify-center h-[70vh] p-4">
                <div className="relative mb-6">
                    <div className="w-16 h-16 border-4 border-red-200 rounded-full"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <X className="w-8 h-8 text-red-600" />
                    </div>
                </div>
                <p className="mt-6 text-red-700 font-semibold text-lg text-center">
                    Firebase 載入失敗
                </p>
                <p className="mt-2 text-gray-600 text-sm text-center">
                    {firebaseError 
                        ? (firebaseError.includes("config is missing") 
                            ? "錯誤：找不到 Firebase 設定。請檢查您是否已將設定寫入程式碼（硬編碼）或 Vercel 環境變數。" 
                            : firebaseError)
                        : "正在準備雲端服務時發生錯誤..."}
                </p>
            </div>
        );
    } else if (view === 'add' || view === 'edit') {
        content = (
            <AddProductForm
                userId={userId}
                db={db}
                onSave={handleSave}
                onCancel={() => setView('list')}
                isLoading={isLoading}
                setIsLoading={setIsLoading}
                initialData={editProduct}
            />
        );
    } else {
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

                {isLoading && products.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64">
                        <Loader className="w-10 h-10 animate-spin text-teal-500 mb-4" />
                        <p className="text-gray-500 font-medium">正在載入產品資料...</p>
                    </div>
                ) : products.length === 0 ? (
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
                                isLoading={isLoading}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        // FIX: Remove script tag (should be in index.html) and React.Fragment
        <div className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-50 to-emerald-50 font-sans">
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');
                body { 
                    font-family: 'Inter', sans-serif; 
                    overflow-x: hidden;
                }
                
                /* Smooth scrolling */
                * {
                    scroll-behavior: smooth;
                }
                
                /* Custom scrollbar */
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
                
                /* Ensure large enough touch targets */
                button { 
                    min-height: 44px;
                    min-width: 44px;
                }
                
                /* Backdrop blur support */
                @supports (backdrop-filter: blur(10px)) {
                    .backdrop-blur-xl {
                        backdrop-filter: blur(24px);
                    }
                    .backdrop-blur-sm {
                        backdrop-filter: blur(8px);
                    }
                }
            `}</style>
            
            {/* FIX: This meta tag should be in your public/index.html file, 
              but we keep it here as a fallback for the single-file setup.
            */}
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />

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
            {view === 'list' && (
                <button
                    onClick={() => {
                        setEditProduct(null);
                        setView('add');
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
                    <div className="hidden absolute bottom-full right-0 mb-3 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowGrap pointer-events-none">
                        新增保養品
                        <div className="absolute top-full right-6 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                    </div>
                </button>
            )}
        </div>
    );
};

export default App;
