import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../auth.controller';

describe('AuthController session cookies', () => {
  const service = {signIn:jest.fn(),signUp:jest.fn(),refreshTokens:jest.fn(),logout:jest.fn(),googleLogin:jest.fn()};
  const response = () => ({cookie:jest.fn(),clearCookie:jest.fn(),redirect:jest.fn(),headersSent:false,writableEnded:false});
  beforeEach(()=>{jest.clearAllMocks();process.env.NODE_ENV='test';process.env.GLOBAL_PREFIX='api';process.env.JWT_EXPIRES_IN='10m';});
  it('passes only the opaque refresh token to canonical rotation',async()=>{
    service.refreshTokens.mockResolvedValue({accessToken:'access',refreshToken:'new-refresh',logoutToken:'logout'});
    const res=response();
    await new AuthController(service as never).refresh({cookies:{refresh_token:'old'}} as any,res as any);
    expect(service.refreshTokens).toHaveBeenCalledWith('old');
    expect(res.cookie).toHaveBeenCalledWith('refresh_token','new-refresh',expect.objectContaining({path:'/api/auth/refresh',httpOnly:true}));
  });
  it('keeps cookies when refresh storage is unavailable',async()=>{
    service.refreshTokens.mockRejectedValue(new ServiceUnavailableException());
    const res=response();
    await expect(new AuthController(service as never).refresh({cookies:{refresh_token:'old'}} as any,res as any)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
  it('clears both legacy and narrow refresh paths on terminal authentication failure',async()=>{
    service.refreshTokens.mockRejectedValue(new UnauthorizedException());
    const res=response();
    await expect(new AuthController(service as never).refresh({cookies:{refresh_token:'old'}} as any,res as any)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token',expect.objectContaining({path:'/api/auth/refresh'}));
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token',expect.objectContaining({path:'/'}));
  });
  it('uses the scoped logout credential when refresh cookie is not sent to the legacy route',async()=>{
    const res=response();
    await new AuthController(service as never).logout({cookies:{logout_session:'logout'}} as any,res as any);
    expect(service.logout).toHaveBeenCalledWith(undefined,'logout');
    expect(res.clearCookie).toHaveBeenCalledWith('logout_session',expect.objectContaining({path:'/api/auth/logout'}));
  });
  it('uses refresh cookie at the path-compatible logout route',async()=>{
    await new AuthController(service as never).logout({cookies:{refresh_token:'refresh'}} as any,response() as any);
    expect(service.logout).toHaveBeenCalledWith('refresh',undefined);
  });
  it('does not issue Google cookies after a guard has sent the response',async()=>{
    const res={...response(),headersSent:true};
    await new AuthController(service as never).googleAuthRedirect({user:{id:7}} as any,res as any);
    expect(service.googleLogin).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });
  it('sets secure scoped cookies and passes device metadata after Google login',async()=>{
    process.env.NODE_ENV='production';process.env.FRONTEND_URL='https://example.test';
    service.googleLogin.mockResolvedValue({token:'access',refreshToken:'refresh',logoutToken:'logout'});
    const res=response();
    await new AuthController(service as never).googleAuthRedirect({user:{id:7},ip:'127.0.0.1',headers:{'user-agent':'fixture'}} as any,res as any);
    expect(service.googleLogin).toHaveBeenCalledWith({id:7},{ip:'127.0.0.1',userAgent:'fixture'});
    expect(res.cookie).toHaveBeenCalledWith('refresh_token','refresh',expect.objectContaining({secure:true,httpOnly:true,sameSite:'lax',path:'/api/auth/refresh'}));
    expect(res.redirect).toHaveBeenCalledWith('https://example.test/auth/callback');
  });
  it('uses configured access lifetime without returning tokens in JSON',async()=>{
    service.signIn.mockResolvedValue({message:'ok',content:{user:{id:7},token:'access',refreshToken:'refresh',logoutToken:'logout'}});
    const res=response();
    const result=await new AuthController(service as never).signIn({email:'a@example.test',password:'password'} as any,res as any);
    expect(res.cookie).toHaveBeenCalledWith('access_token','access',expect.objectContaining({maxAge:600000}));
    expect(result).toEqual({message:'ok',content:{user:{id:7}}});
  });
});
