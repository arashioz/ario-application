/** تشخیص اینکه مرورگر اجازه GPS می‌دهد (HTTPS یا localhost) */
export function isGeoSecureContext(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export function geoErrorMessage(err: GeolocationPositionError | Error | unknown): string {
  if (!isGeoSecureContext()) {
    return 'موقعیت فقط روی HTTPS یا localhost کار می‌کند. آدرس را به https://… یا http://localhost:5173 عوض کن (IP مثل 192.168… روی HTTP اجازه GPS نمی‌دهد).';
  }
  if (!navigator.geolocation) {
    return 'این مرورگر/دستگاه موقعیت‌یاب ندارد';
  }
  const code = (err as GeolocationPositionError)?.code;
  if (code === 1) {
    return 'اجازه موقعیت رد شده. در تنظیمات مرورگر/سایت Location را Allow کن و صفحه را رفرش کن.';
  }
  if (code === 2) {
    return 'موقعیت در دسترس نیست — GPS گوشی را روشن کن و بیرون از حالت هواپیما باش.';
  }
  if (code === 3) {
    return 'زمان موقعیت‌یابی تمام شد — دوباره تلاش کن.';
  }
  if (err instanceof Error && err.message) return err.message;
  return 'دسترسی به موقعیت داده نشد';
}

export function getCurrentPositionAsync(
  options?: PositionOptions
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('موقعیت‌یاب پشتیبانی نمی‌شود'));
      return;
    }
    if (!isGeoSecureContext()) {
      reject(new Error(geoErrorMessage(null)));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 5000,
      ...options,
    });
  });
}
