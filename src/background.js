import './background.scss';
import './fluid-cover.scss';
import { getGradientFromPalette } from './color-utils';
import { PseudoFluidCover, PSEUDO_FLUID_DEFAULTS } from './fluid-cover';
import ColorThief from 'colorthief';

const useState = React.useState;
const useEffect = React.useEffect;
const useRef = React.useRef;
const useCallback = React.useCallback;

const colorThief = new ColorThief();

export function Background(props) {
	const [type, setType] = useState(props.type ?? 'blur'); // blur, gradient, fluid, pseudo-fluid, solid
	const [url, setUrl] = useState('');
	const [staticFluid, setStaticFluid] = useState(true);
	const [pseudoFluidConfig, setPseudoFluidConfig] = useState(PSEUDO_FLUID_DEFAULTS);
	const image = props.image;

	
	if (!props.isFM) {
		useEffect(() => {
			const observer = new MutationObserver(() => {
				if (image.src === url) return;
				if (image.complete) {
					setUrl(image.src);
				}
			});
			observer.observe(image, { attributes: true, attributeFilter: ['src'] });
			const onload = () => {
				setUrl(image.src);
			};
			image.addEventListener('load', onload);
			return () => {
				observer.disconnect();
				image.removeEventListener('load', onload);
			}
		}, [image]);
	} else {
		useEffect(() => {
			const imageContainer = image;
			if (imageContainer.querySelector('.cvr.j-curr img')) {
				setUrl(imageContainer.querySelector('.cvr.j-curr img').src);
				props.imageChangedCallback(imageContainer.querySelector('.cvr.j-curr img'));
			}
			const observer = new MutationObserver(() => {
				if (imageContainer.querySelector('.cvr.j-curr img')) {
					setUrl(imageContainer.querySelector('.cvr.j-curr img').src);
					props.imageChangedCallback(imageContainer.querySelector('.cvr.j-curr img'));
				}
			});
			observer.observe(imageContainer, { childList: true, subtree: true });
			return () => {
				observer.disconnect();
			}
		}, [image]);
	}

	useEffect(() => {
		document.addEventListener('rnp-background-type', (e) => {
			setType(e.detail.type ?? 'blur');
		});
		document.addEventListener('rnp-static-fluid', (e) => {
			setStaticFluid(e.detail ?? false);
		});
		document.addEventListener('rnp-pseudo-fluid-config', (e) => {
			setPseudoFluidConfig(prev => ({ ...prev, ...e.detail }));
		});
	}, []);
	
	return (
		<>
			{type === 'blur' && (
				<BlurBackground url={url} />
			)}
			{type === 'gradient' && (
				<GradientBackground url={url} />
			)}
			{type === 'fluid' && (
				<FluidBackground url={url} static={staticFluid} isFM={props.isFM} />
			)}
			{type === 'pseudo-fluid' && (
				<PseudoFluidBackground url={url} config={pseudoFluidConfig} isFM={props.isFM} />
			)}
			{type === 'solid' && (
				<SolidBackground />
			)}
			{type === 'none' && (
				<>
					<div className="rnp-background-none"></div>
					<style>
						{`
							body.mq-playing .g-single {
								background: transparent !important;
							}
							body.mq-playing .g-sd,
							body.mq-playing .g-mn {
								opacity: 0;
							}
						`}
					</style>
				</>
			)}
		</>
	);
}
function BlurBackground(props) {
	const ref = useRef();
	useEffect(() => {
		if (!props.url) return;
		ref.current.style.backgroundImage = `url(${props.url})`;
		ref.current.style.transition = 'background-image 1.5s ease';
	}, [props.url]);

	return (
		<div ref={ref} className="rnp-background-blur"/>
	);
}

function GradientBackground(props) {
	const [gradient, setGradient] = useState('linear-gradient(-45deg, #666, #fff)');
	useEffect(() => {
		const image = new Image();
		image.crossOrigin = 'Anonymous';
		console.log('loading image');
		image.onload = () => {
			console.log('image loaded');
			const palette = colorThief.getPalette(image);
			setGradient(getGradientFromPalette(palette));
		};
		image.src = props.url;
	}, [props.url]);

	return (
		<div className="rnp-background-gradient" style={{ backgroundImage: gradient }} />
	);
}

function PseudoFluidBackground(props) {
	const containerRef = useRef();
	const coverRef = useRef(null);
	const [songId, setSongId] = useState("0");
	const playState = useRef(true);

	const onPlayStateChange = (id, state) => {
		if (!props.isFM) {
			playState.current = document.querySelector("#main-player .btnp").classList.contains("btnp-pause");
		} else {
			playState.current = document.querySelector(".m-player-fm .btnp").classList.contains("btnp-pause");
		}
		setSongId(id);
		if (coverRef.current) {
			coverRef.current.setPaused(!playState.current);
		}
	};

	useEffect(() => {
		legacyNativeCmder.appendRegisterCall(
			"PlayState",
			"audioplayer",
			onPlayStateChange
		);
		return () => {
			legacyNativeCmder.removeRegisterCall(
				"PlayState",
				"audioplayer",
				onPlayStateChange
			);
		};
	}, []);

	useEffect(() => {
		if (!props.url || !containerRef.current) return;
		
		const initOrUpdate = async () => {
			if (!coverRef.current) {
				coverRef.current = new PseudoFluidCover(containerRef.current, props.config);
				await coverRef.current.init(props.url);
				coverRef.current.setPaused(!playState.current);
			} else {
				await coverRef.current.updateImage(props.url);
			}
		};
		initOrUpdate();
	}, [props.url]);

	useEffect(() => {
		return () => {
			if (coverRef.current) {
				coverRef.current.dispose();
				coverRef.current = null;
			}
		};
	}, []);

	// 监听配置变化
	useEffect(() => {
		if (coverRef.current) {
			coverRef.current.updateConfig(props.config);
		}
	}, [props.config]);

	return (
		<div className="rnp-background-pseudo-fluid">
			<div ref={containerRef} className="rnp-pseudo-fluid-container" />
			<div className="rnp-pseudo-fluid-blur-layer" />
			<div className="rnp-background-pseudo-fluid-dim" />
		</div>
	);
}

function FluidBackground(props) {
	const [canvas1, canvas2, canvas3, canvas4] = [useRef(), useRef(), useRef(), useRef()];
	const feTurbulence = useRef();
	const fluidContainer = useRef();
	const staticFluidStyleRef = useRef();
	const [songId, setSongId] = useState("0");

	const playState = useRef(document.querySelector("#main-player .btnp").classList.contains("btnp-pause"));

	const onPlayStateChange = (id, state) => {
		//playState.current = (state.split('|')[1] == 'resume');
		if (!props.isFM) {
			playState.current = document.querySelector("#main-player .btnp").classList.contains("btnp-pause");
		} else {
			playState.current = document.querySelector(".m-player-fm .btnp").classList.contains("btnp-pause");
		}
		setSongId(id);
		fluidContainer.current.classList.toggle("paused", !playState.current);
		//console.log(id, playState.current, state.split('|')[1], document.querySelector("#main-player .btnp").classList.contains("btnp-pause"));
	};

	useEffect(() => {
		fluidContainer.current.classList.toggle("paused", !playState.current);
	}, [songId]);

	useEffect(() => {
		legacyNativeCmder.appendRegisterCall(
			"PlayState",
			"audioplayer",
			onPlayStateChange
		);
		return () => {
			legacyNativeCmder.removeRegisterCall(	
				"PlayState",
				"audioplayer",
				onPlayStateChange
			);
		}
	}, []);

	useEffect(() => {
		canvas1.current.getContext('2d').filter = 'blur(5px)';
		canvas2.current.getContext('2d').filter = 'blur(5px)';
		canvas3.current.getContext('2d').filter = 'blur(5px)';
		canvas4.current.getContext('2d').filter = 'blur(5px)';
	}, []);

	useEffect(() => {
		const image = new Image();
		image.crossOrigin = 'Anonymous';
		image.onload = () => {
			const { width, height } = image;
			canvas1.current.getContext('2d').drawImage(image, 0, 0, width / 2, height / 2, 0, 0, 100, 100);
			canvas2.current.getContext('2d').drawImage(image, width / 2, 0, width / 2, height / 2, 0, 0, 100, 100);
			canvas3.current.getContext('2d').drawImage(image, 0, height / 2, width / 2, height / 2, 0, 0, 100, 100);
			canvas4.current.getContext('2d').drawImage(image, width / 2, height / 2, width / 2, height / 2, 0, 0, 100, 100);
		};
		image.src = props.url;
		feTurbulence.current.setAttribute('seed', parseInt(Math.random() * 1000));
		staticFluidStyleRef.current.innerHTML = `
			body.static-fluid .rnp-background-fluid-rect {
				animation-play-state: paused !important;
				animation-delay: -${parseInt(Math.random() * 150)}s !important;
			}
			body.static-fluid .rnp-background-fluid-rect canvas {
				animation-play-state: paused !important;
				animation-delay: -${parseInt(Math.random() * 60)}s !important;
			}
		`;
	}, [props.url]);

	const onResize = () => {
		const { width, height } = document.body.getBoundingClientRect();
		const viewSize = Math.max(width, height);
		const canvasSize = viewSize * 0.707;

		const canvasList = [canvas1, canvas2, canvas3, canvas4];
		for (let x = 0; x <= 1; x++) {
			for (let y = 0; y <= 1; y++) {
				const canvas = canvasList[y * 2 + x];
				canvas.current.style.width = `${canvasSize}px`;
				canvas.current.style.height = `${canvasSize}px`;
				const signX = x === 0 ? -1 : 1, signY = y === 0 ? -1 : 1;
				canvas.current.style.left = `${(width / 2 + signX * canvasSize * 0.35) - canvasSize / 2}px`;
				canvas.current.style.top = `${(height / 2 + signY * canvasSize * 0.35) - canvasSize / 2}px`;
			}
		}
	}

	useEffect(() => {
		window.addEventListener('resize', onResize);
		onResize();
		return () => {
			window.removeEventListener('resize', onResize);
		}
	}, []);

	// 音频暂停时停止流体移动，不再每帧修改 feDisplacementMap scale
	return (
		<>
			<style ref={staticFluidStyleRef} type="text/css">
				{`
					body.static-fluid .rnp-background-fluid-rect {
						animation-play-state: paused !important;
						animation-delay: 0s !important;
					}
					body.static-fluid .rnp-background-fluid-rect canvas {
						animation-play-state: paused !important;
						animation-delay: 0s !important;
					}
				`}

			</style>
			<svg width="0" height="0" style={{ position: 'absolute' }}>
				<filter id="fluid-filter" x="-20%" y="-20%" width="140%" height="140%" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
					<feTurbulence ref={feTurbulence} type="fractalNoise" baseFrequency="0.005" numOctaves="1" seed="0"></feTurbulence> 
					<feDisplacementMap in="SourceGraphic" scale="400"></feDisplacementMap>
				</filter>
			</svg>
			<div className="rnp-background-fluid" style={{ backgroundImage: `url(${props.url})` }}>
				<div className="rnp-background-fluid-rect" ref={fluidContainer} >
					<canvas ref={canvas1} className="rnp-background-fluid-canvas" canvasID="1" width="100" height="100"/>
					<canvas ref={canvas2} className="rnp-background-fluid-canvas" canvasID="2" width="100" height="100"/>
					<canvas ref={canvas3} className="rnp-background-fluid-canvas" canvasID="3" width="100" height="100"/>
					<canvas ref={canvas4} className="rnp-background-fluid-canvas" canvasID="4" width="100" height="100"/>
				</div>
			</div>
		</>
	);
}

function SolidBackground() {
	return (
		<div className="rnp-background-solid"></div>
	);
}
