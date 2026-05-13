import { Composition } from 'remotion';
import { loadFont as loadManrope } from '@remotion/google-fonts/Manrope';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { HeroLoop } from './compositions/HeroLoop';

loadManrope();
loadInter();

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HeroLoop"
        component={HeroLoop}
        durationInFrames={240}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
