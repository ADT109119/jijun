// JavaScript Document


function ActiveEditButton(){
	
	document.querySelectorAll(".ChaJunItemSection.Edit").forEach(function(Item){
		Item.onclick = function(){
			
			let EditConfirmWindowBackground = document.createElement("div");
			EditConfirmWindowBackground.className = "EditConfirmWindowBackground";
			
			EditConfirmWindowBackground.onclick = function(event){
				if(event.target.classList.contains("EditConfirmWindowBackground") || event.target.classList.contains("No"))
					this.remove()
			}
			
			let EditConfirmWindows = document.createElement("div");
			EditConfirmWindows.className = "EditConfirmWindow";
			
			let Word1 = document.createElement("span");
			Word1.innerHTML = "您是否確定要更改"

			let date = document.createElement("span");
			date.innerHTML = Item.dataset.date;
			date.style.color = "#FF0000";
			date.className = "EditConfirmWindowsDate";
			
			let classesname = document.createElement("span");
			classesname.innerHTML = Item.dataset.classesname;
			classesname.style.color = "#6093FF"
			
			let Word2 = document.createElement("span");
			Word2.innerHTML = "的第"
			
			let i = document.createElement("span");
			i.innerHTML = Item.dataset.i;
			
			let Word3 = document.createElement("span");
			Word3.innerHTML = "筆資料?"
			
			let div = document.createElement("div");
			div.style.bottom = "10%";
			div.style.position = "absolute";
			div.style.width = "100%";
			
			let YesButton = document.createElement("span");
			YesButton.innerHTML = '<a class="ButtonA" href="#"><span class="ChaJunEditConfirm Yes">Yes</span></a>'
			YesButton.onclick = function(){
				EditWindow(Item.dataset.date, Item.dataset.classes, Item.dataset.classesname, Item.dataset.i)
				document.querySelector(".EditConfirmWindowBackground").remove();
			}
			
			let NoButton = document.createElement("span");
			NoButton.innerHTML = '<a class="ButtonA" href="#"><span class="ChaJunEditConfirm No">No</span></a>'
			
			div.append(YesButton);
			div.append(NoButton);

			EditConfirmWindows.append(Word1);
			EditConfirmWindows.append(date);
			EditConfirmWindows.append(classesname);
			EditConfirmWindows.append(Word2);
			EditConfirmWindows.append(i);
			EditConfirmWindows.append(Word3);
			EditConfirmWindows.append(div);
			
			EditConfirmWindowBackground.append(EditConfirmWindows);
			document.body.append(EditConfirmWindowBackground);
			
		}
	})
	
}



function EditWindow(date, classes, classesName, i){
	
	let dateSplit = date.split("-");
	
	let EditWindowBackground = document.createElement("div");
	EditWindowBackground.className = "EditWindowBackground";
	
	EditWindowBackground.onclick = function(event){
			if(event.target.classList.contains("EditWindowBackground"))
				this.remove()
			}
	
	let EditWindow = document.createElement("div");
	EditWindow.className = "EditWindow";
	
	let div1 = document.createElement("div");
	div1.style.position = "relative";
	div1.style.top = "10%";

	let displayDate = document.createElement("span");
	displayDate.innerHTML = date;
	displayDate.style.color = "#FF0000";
	
	let Word1 = document.createElement("span");
	Word1.innerHTML = " "
	
	let displayClasses = document.createElement("span");
	displayClasses.innerHTML = classesName;
	displayClasses.style.color = "#6093FF"
	
	let Word2 = document.createElement("span");
	Word2.innerHTML = "<br>第"
	
	let display_i = document.createElement("span");
	display_i.innerHTML = i;
	
	let Word3 = document.createElement("span");
	Word3.innerHTML = "筆資料"
	
	let div2 = document.createElement("div");
	div2.style.position = "relative";
	div2.style.top = "10%";

	let Lable1 = document.createElement("lable");
	Lable1.innerHTML = "金額"
	
	let MoneyInput = document.createElement("input");
	MoneyInput.className = "EditWindowMoneyInput";
	MoneyInput.type = "Number";
	MoneyInput.value = AllTheData[dateSplit[0]][dateSplit[1]][dateSplit[2]][ChaJunIn_Or_Out][classes]["money"][i]

	let Lable2 = document.createElement("lable");
	Lable2.innerHTML = "說明"
	
	let DescriptionInput = document.createElement("input");
	DescriptionInput.className = "EditWindowDescriptionInput";
	DescriptionInput.value = AllTheData[dateSplit[0]][dateSplit[1]][dateSplit[2]][ChaJunIn_Or_Out][classes]["description"][i]
	
	let div3 = document.createElement("div");
	div3.style.position = "relative";
	div3.style.top = "10%";

	
	let SaveButton = document.createElement("span");
	SaveButton.innerHTML = '<a class="ButtonA" href="#"><span class="ChaJunEditWindows Save">儲存</span></a>'
	SaveButton.onclick = function(){
		
		AllTheData[dateSplit[0]][dateSplit[1]][dateSplit[2]][ChaJunIn_Or_Out][classes]["money"][i] = document.querySelector(".EditWindowMoneyInput").value;
		
		AllTheData[dateSplit[0]][dateSplit[1]][dateSplit[2]][ChaJunIn_Or_Out][classes]["description"][i] = document.querySelector(".EditWindowDescriptionInput").value;
		
		ChaJunTransition();
		HomePageMoneyDisplay();
		
		localStorage.setItem("AllTheData", JSON.stringify(AllTheData));
		document.querySelector(".EditWindowBackground").remove();
		
	}

	let CalcleButton = document.createElement("span");
	CalcleButton.innerHTML = '<a class="ButtonA" href="#"><span class="ChaJunEditWindows Calcle">取消</span></a>'
	CalcleButton.onclick = function(){
		document.querySelector(".EditWindowBackground").remove();
	}
	
	let DeleteButton = document.createElement("span");
	DeleteButton.innerHTML = '<a class="ButtonA" href="#"><span class="ChaJunEditWindows Delete">刪除該筆資料</span></a>'
	DeleteButton.onclick = function(){
		
		AllTheData[dateSplit[0]][dateSplit[1]][dateSplit[2]][ChaJunIn_Or_Out][classes]["money"].splice(i, 1)
		AllTheData[dateSplit[0]][dateSplit[1]][dateSplit[2]][ChaJunIn_Or_Out][classes]["description"].splice(i, 1)
		
		ChaJunTransition();
		HomePageMoneyDisplay();

		localStorage.setItem("AllTheData", JSON.stringify(AllTheData));
		document.querySelector(".EditWindowBackground").remove();
		
	}


	div1.append(displayDate);
	div1.append(Word1);
	div1.append(displayClasses);
	div1.append(Word2);
	div1.append(display_i);
	div1.append(Word3);
	
	div2.append(Lable1);
	div2.append(MoneyInput);
	div2.append(Lable2);
	div2.append(DescriptionInput);
	
	div3.append(SaveButton);
	div3.append(CalcleButton);
	div3.append(DeleteButton);
		
	EditWindow.append(div1);
	EditWindow.append(div2);
	EditWindow.append(div3);
		
	
	EditWindowBackground.append(EditWindow);
	document.body.append(EditWindowBackground);
	
}















