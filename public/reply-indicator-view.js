/* Build 184 Reply Indicator View
 * Visual-only owner. Gesture and reply execution remain external.
 */
(function(){
  class ReplyIndicatorView {
    constructor(root){
      this.root=root||null;
      this.circle=this.root?.querySelector?.('.reply-circle')||null;
      this.ripple=this.root?.querySelector?.('.reply-ripple')||null;
      this.armed=false;
    }
    updateProgress(progress){
      const p=Math.max(0,Math.min(1,Number(progress)||0));
      if(!this.circle)return;
      this.circle.style.setProperty('--reply-progress',String(p));
      this.circle.style.transform=`scale(${0.2+p*0.8})`;
      this.circle.style.opacity=String(p);
    }
    setArmed(){this.armed=true;if(this.root)this.root.dataset.state='armed';}
    reset(){this.armed=false;if(this.root)this.root.dataset.state='hidden';if(this.circle){this.circle.style.transform='scale(0)';this.circle.style.opacity='0';}}
  }
  window.ReplyIndicatorView=ReplyIndicatorView;
})();
