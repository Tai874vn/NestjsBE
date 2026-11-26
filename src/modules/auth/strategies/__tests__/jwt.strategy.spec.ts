import { JwtStrategy } from '../jwt.strategy';
import { JwtPayload } from '../../../../types';

describe('JwtStrategy session validation',()=>{
  const sessions={assertAccessSession:jest.fn()};
  const payload:JwtPayload={sub:7,role:'user',sid:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',jti:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',ver:0,type:'access'};
  beforeEach(()=>{jest.clearAllMocks();process.env.JWT_SECRET='test-secret';});
  it('rejects refresh and old access JWTs without session identifiers',async()=>{
    const strategy=new JwtStrategy(sessions as never);
    await expect(strategy.validate({} as any,{...payload,type:'refresh'})).rejects.toMatchObject({response:{code:'INVALID_ACCESS_TOKEN'}});
    await expect(strategy.validate({} as any,{sub:7,email:'old@example.test',type:'access'})).rejects.toMatchObject({response:{code:'INVALID_ACCESS_TOKEN'}});
    expect(sessions.assertAccessSession).not.toHaveBeenCalled();
  });
  it('checks session and jti before trusting role claims and caches only within the request',async()=>{
    const strategy=new JwtStrategy(sessions as never);
    const request={} as any;
    const user=await strategy.validate(request,payload);
    expect(user).toEqual({id:7,role:'user',sessionId:payload.sid});
    await strategy.validate(request,payload);
    expect(sessions.assertAccessSession).toHaveBeenCalledTimes(1);
    expect(sessions.assertAccessSession).toHaveBeenCalledWith(payload.sid,7,payload.jti);
  });
  it('propagates session revocation instead of treating it as an invalid signature',async()=>{
    sessions.assertAccessSession.mockRejectedValueOnce(new Error('revoked'));
    await expect(new JwtStrategy(sessions as never).validate({} as any,payload)).rejects.toThrow('revoked');
  });
});
