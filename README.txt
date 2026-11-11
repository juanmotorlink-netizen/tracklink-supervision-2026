TRACKLINK SUPERVISIÓN 2026 — PROYECTO INICIAL

Incluye:
- Interfaz adaptable a celular y escritorio, instalable como PWA.
- Formulario de supervisión con vestimenta, revisión de instalación y observaciones.
- Selección de varias fotografías desde cámara/galería.
- Firmas dibujadas en pantalla.
- Guardado local con IndexedDB y cola básica de sincronización.
- Integración preparada para Firebase Authentication, Firestore y Storage.
- Botón de borrar con confirmación.
- Exportación XLSX de registros (requiere conexión para cargar SheetJS).
- Reglas iniciales de Firestore y Storage.

IMPORTANTE:
Este paquete es el código fuente inicial; no es un APK firmado ni está publicado en Play Store.
Para activar nube y autenticación:
1. Crear proyecto en https://console.firebase.google.com/
2. Habilitar Authentication > Email/Password.
3. Crear Firestore Database y Storage.
4. Copiar configuración de aplicación web a firebaseConfig.js.
5. Publicar firestore.rules y storage.rules desde Firebase Console.
6. Crear usuarios en Authentication. En Firestore, crear users/{UID} con { "role": "admin" } o { "role": "supervisor" }.
7. Servir esta carpeta por HTTPS (por ejemplo Firebase Hosting). La PWA se puede instalar desde Chrome en Android.

NOTAS DE SEGURIDAD Y PRODUCCIÓN:
- Cambiar las reglas y probarlas antes de usar datos reales.
- Crear el primer administrador desde un entorno seguro; no abrir permisos de escritura pública.
- El prototipo conserva registros localmente y sincroniza registros pendientes al recuperar conexión.
- Las firmas se guardan como datos del registro; las fotos se suben a Storage cuando hay sesión Firebase.
- La exportación actual genera una hoja XLSX de datos. La inclusión de fotos y firmas dentro del Excel requiere una etapa adicional.
- Para APK nativo, Play Store, notificaciones y sincronización robusta en segundo plano se requiere empaquetado/pruebas adicionales (por ejemplo Capacitor o Android Studio).
