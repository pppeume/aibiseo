// 브라우저 번들용 대체 모듈 (Node 전용 모듈 대신 사용)
export default {};
export const rmSync = () => {};
export const join = (...a) => a.join('/');
export const basename = (p) => String(p).split('/').pop();
