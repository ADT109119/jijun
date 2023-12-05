// JavaScript Document

function CreateAndDownloadAllTheData() {
	
    let a = document.createElement('a');
    let blob = new Blob([JSON.stringify(AllTheData)]);
    a.download = TodaysDate + "記帳紀錄.json";
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(blob);
	
}


function InputOuterAllTheData(file){
	
	if(file.length == 0){
		console.log('請選擇檔案!');
    	return;
	}
	
	let reader = new FileReader();
	reader.onload = function fileReadCompleted(){
		
		let yes = confirm("此操作會覆蓋目前的資料!您確定要執行嗎?")
		
		if(yes){
			AllTheData = JSON.parse(reader.result);
			localStorage.setItem("AllTheData", reader.result);
			alert("已成功讀取!");
			location.reload();
		}else{
			alert("已取消操作!")
			location.reload();
		}
		
		//console.log(reader.result);
	}
	
	reader.readAsText(file[0]);
}



function CloudDataSave(){
	
	
	
	alert("此功能尚未完成!!!");
}






